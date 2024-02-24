import Hashes from 'jshashes';

import { EntryPoint, Request, UserInfo, ConstituentStatus } from './types';
import { TwilioRequestBody } from './twilio_util';
import * as RedisApiUtil from './redis_api_util';
import redisClient from './redis_client';
import * as TwilioUtil from './twilio_util';
import * as DbApiUtil from './db_api_util';
import * as LoadBalancer from './load_balancer';
import * as Router from './router';
import * as KeywordParser from './keyword_parser';
import * as SlackApiUtil from './slack_api_util';
import AgentManagementService from './agent_management_service';
import ConstituentManagementService from './constituent_management_service';
import logger from './logger';
import * as SlackBlockUtil from './slack_block_util';
import { SlackCallbackId } from './slack_interaction_ids';
import { SlackInteractionEventPayload } from './slack_interaction_handler';
import * as SlackInteractionHandler from './slack_interaction_handler';
import * as Sentry from '@sentry/node';
import { wrapLambdaHandlerForSentry } from './sentry_wrapper';
import DbService from './db_service';
import config from './config';

export type InteractivityHandlerMetadata = { viewId?: string };

export default class ServiceCoordinator {
  // Example of storing references to service instances
  //   private slackService: any; // Replace 'any' with the actual type of your Slack service
  //   private twilioService: any; // Replace 'any' with the actual type of your Twilio service
  private constituentManagementService: ConstituentManagementService;
  private agentManagementService: AgentManagementService;
  private dbService: DbService;

  constructor(
    constituentManagementService: ConstituentManagementService,
    agentManagementService: AgentManagementService,
    dbService: DbService,
    // slackService: any,
    // twilioService: any
  ) {
    this.constituentManagementService = constituentManagementService;
    this.agentManagementService = agentManagementService;
    this.dbService = dbService;
    // this.slackService = slackService;
    // this.twilioService = twilioService;
  }

  private BACKGROUND_TASKS = {
    handleIncomingSlackCommand: this.handleIncomingSlackCommand.bind(this),
    handleSlackInteractivity: this.handleSlackInteractivity.bind(this),
    handleIncomingSlackMessageEvent: this.handleIncomingSlackMessageEvent.bind(this),
    handleIncomingSlackAppMentionEvent: this.handleIncomingSlackAppMentionEvent.bind(this)
  };

  // Method to handle incoming messages from Slack.
  public async handleIncomingSlackMessageEvent(reqBody: Router.SlackEventRequestBody,
    twilioCallbackURL: string,
    {
      retryCount,
      retryReason,
    }: { retryCount: number | undefined; retryReason: string | undefined }): Promise<void> {
    this.agentManagementService.handleSlackMessageEvent(
      reqBody,
      twilioCallbackURL,
      {
        retryCount,
        retryReason,
      }
    );
  }

  // Method to handle incoming messages that contain a mention of the Slack app (unofficial Slack commands).
  public async handleIncomingSlackAppMentionEvent(reqBody: Router.SlackEventRequestBody): Promise<void> {
    await this.agentManagementService.handleSlackAppMentionEvent(
      reqBody
    );
  }

  // Method to handle incoming messages that contain Slack commands (official).
  public async handleIncomingSlackCommand(channelId: string,
    channelName: string,
    userId: string,
    userName: string,
    command: string,
    text: string,
    responseUrl: string): Promise<void> {
    await this.agentManagementService.handleSlackCommand(
      channelId, channelName, userId, userName, command, text, responseUrl
    );
  }

  // This wrapper is necessary because agentManagementServiceInstance.handleSlackInteractivity
  // ban't be listed in BACKGROUND_TASKS directly.
  private async handleSlackInteractivity(
    payload: SlackInteractionEventPayload,
    metadata: InteractivityHandlerMetadata
  ): Promise<void> {
    await agentManagementServiceInstance.handleSlackInteractivity(payload, metadata);
  }

  // Method to handle incoming slack interactivity.
  // This is the only public Slack method of ServiceCoordinator that isn't itself meant to be
  // called enqueued as a background task. Instead, it itself enqueues background tasks
  // conditionally based on the type of interactivity.
  public async handleIncomingSlackInteractivity(payload: SlackInteractionEventPayload): Promise<any> {
    let response: any;
    let shouldEnqueueBackgroundTask = true;
    const metadata: InteractivityHandlerMetadata = {};

    if (
      [
        SlackCallbackId.RESET_DEMO,
        SlackCallbackId.MANAGE_ENTRY_POINTS,
        SlackCallbackId.SHOW_NEEDS_ATTENTION,
        SlackCallbackId.ROUTE_TO_JOURNEY,
      ].includes(payload.callback_id as SlackCallbackId)
    ) {
      logger.info(
        `SERVER POST /slack-interactivity: Determined ${payload.callback_id} opens a modal`
      );

      // For certain actions, we always show a modal. Because we have to show
      // this modal within 3 seconds, we immediately make the call to show a
      // loading state, and then pass the modal ID on to the async task to
      // update the modal
      metadata.viewId = await SlackApiUtil.renderModal(
        payload.trigger_id,
        SlackBlockUtil.loadingSlackView()
      );
    }

    if (
      payload.type === 'view_submission' &&
      (payload.view?.callback_id as SlackCallbackId) ===
      SlackCallbackId.MANAGE_ENTRY_POINTS
    ) {
      // Check if we need to render a confirmation modal. This needs to happen
      // synchronously to avoid 3 second timeout.
      const confirmationModal =
        SlackInteractionHandler.maybeGetManageEntryPointsConfirmationModal(
          payload
        );
      if (confirmationModal) {
        logger.info(
          `SERVER POST /slack-interactivity: Determined ${payload.view?.callback_id} pushes a view onto modal`
        );

        response = {
          response_action: 'push',
          view: confirmationModal,
        };

        shouldEnqueueBackgroundTask = false;
      } else {
        logger.info(
          `SERVER POST /slack-interactivity: Determined ${payload.view?.callback_id} updates the view in modal`
        );

        // This will change, so show loading state again.
        response = {
          response_action: 'update',
          view: SlackBlockUtil.loadingSlackView(),
        };
      }
    }

    // On AWS Lambda, returning a response will immediately pause execution. So it's
    // important to enqueue the background task BEFORE responding with anything.
    if (shouldEnqueueBackgroundTask) {
      await this.enqueueBackgroundTask('handleSlackInteractivity', payload, metadata);
    }

    return response;
  }

  // Method to handle incoming SMS messages from Twilio.
  public async handleIncomingTwilioMessage(
    req: Request,
    // TODO: Return a status of some kind, instead of void.
    entryPoint: EntryPoint
  ): Promise<void> {
    logger.info('Entering SERVER.handleIncomingTwilioMessage');

    const reqBody = req.body as TwilioRequestBody;
    const userPhoneNumber = reqBody.From;

    if (config.useRefactoredPath) {
      // TODO: Have the logic within this block encapsulated within a method of constituentManagementService,
      // so that clients can modify the behavior (e.g. reply with unsubscribe confirmation).
      // Have this be one of the major paths (with constitutent status STOP).
      if (await this.agentManagementService.isPhoneNumberBlocked(userPhoneNumber)) {
        logger.info(
          `SERVER.handleIncomingTwilioMessage: Received text from blocked phone number: ${userPhoneNumber}.`
        );
        return;
      }
    } else {
      const inboundTextsBlocked = await RedisApiUtil.getHashField(
        redisClient,
        'twilioBlockedUserPhoneNumbers',
        userPhoneNumber
      );
      if (inboundTextsBlocked === '1') {
        logger.info(
          `SERVER.handleIncomingTwilioMessage: Received text from blocked phone number: ${userPhoneNumber}.`
        );
        return;
      }
    }

    const twilioPhoneNumber = reqBody.To;
    const userMessage = reqBody.Body;
    const userAttachments = TwilioUtil.getAttachments(reqBody);
    const MD5 = new Hashes.MD5();
    const userId = MD5.hex(userPhoneNumber);
    const twilioCallbackURL = TwilioUtil.twilioCallbackURL(req);
    // TODO: Set these in the constructor instead.
    this.constituentManagementService.setConstituentId(userId);
    this.constituentManagementService.setConstituentPhoneNumber(userPhoneNumber);
    this.constituentManagementService.setConstituentMessage(userMessage);
    this.constituentManagementService.setUserAttachments(userAttachments);
    this.constituentManagementService.setTwilioPhoneNumber(twilioPhoneNumber);
    this.constituentManagementService.setEntryPoint(entryPoint);
    this.constituentManagementService.setTwilioCallbackURL(twilioCallbackURL);
    logger.info(`SERVER.handleIncomingTwilioMessage: Receiving Twilio message from ${entryPoint} entry point voter,
                          userPhoneNumber: ${userPhoneNumber},
                          twilioPhoneNumber: ${twilioPhoneNumber},
                          userMessage: ${userMessage},
                          userId: ${userId}`);

    let inboundDbMessageEntry;
    if (config.useRefactoredPath) {
      inboundDbMessageEntry = this.dbService.populateInitialIncomingConstituentMessageDbEntry({
        userMessage,
        userPhoneNumber,
        twilioPhoneNumber,
        twilioMessageSid: reqBody.SmsMessageSid,
        twilioAttachments: userAttachments,
        entryPoint: LoadBalancer.PUSH_ENTRY_POINT,
      });
      this.constituentManagementService.setInboundDbMessageEntry(inboundDbMessageEntry);
    } else {
      inboundDbMessageEntry =
        DbApiUtil.populateIncomingDbMessageTwilioEntry({
          userMessage,
          userPhoneNumber,
          twilioPhoneNumber,
          twilioMessageSid: reqBody.SmsMessageSid,
          twilioAttachments: userAttachments,
          entryPoint: LoadBalancer.PUSH_ENTRY_POINT,
        });
    }

    let userInfo: UserInfo | null = null;
    const redisHashKey = `${userId}:${twilioPhoneNumber}`;
    let returningVoter = false;
    if (config.useRefactoredPath) {
      userInfo = await this.constituentManagementService.fetchAndLoadConstituentInfo(twilioPhoneNumber);
      await this.constituentManagementService.fetchAndLoadOptOutStatus();
      this.constituentManagementService.determineConstituentStatus();
      // userInfo should always be true here.
      if (config.enableMultiCycleFeature && userInfo && this.constituentManagementService.getConstituentStatus() == ConstituentStatus.RETURNING) {
        await this.agentManagementService.endVoterSession(redisClient, userInfo, twilioPhoneNumber);
      }
    } else {
      logger.info(
        `SERVER.handleIncomingTwilioMessage (${userId}): Retrieving userInfo using redisHashKey: ${redisHashKey}`
      );
  
      userInfo = (await RedisApiUtil.getHash(
        redisClient,
        redisHashKey
      )) as UserInfo | null;
      logger.info(
        `SERVER.handleIncomingTwilioMessage (${userId}): Successfully received Redis response for userInfo retrieval with redisHashKey ${redisHashKey}, userInfo: ${JSON.stringify(
          userInfo
        )}`
      );

      // New session?
      let returningVoter = false;
      if (userInfo && Router.isStaleSession(userInfo)) {
        logger.info(
          `SERVER.handleIncomingTwilioMessage (${userId}): no sessionStartEpoch, starting with fresh userInfo`
        );
        await Router.endVoterSession(redisClient, userInfo, twilioPhoneNumber);
        userInfo = null;
        returningVoter = true;
      }
    }













    if (config.useRefactoredPath) {
      logger.info("ConstituentStatus: ", this.constituentManagementService.getConstituentStatus());
      const constituentIsAllowedToContinue = await this.constituentManagementService.handleOptOutLogic(twilioPhoneNumber, inboundDbMessageEntry);
      if (!constituentIsAllowedToContinue) return;

      switch (this.constituentManagementService.getConstituentStatus()) {
        case ConstituentStatus.NEW:
          let userOptions = {
            userPhoneNumber,
            userMessage,
            userAttachments,
            userId,
          };
          userInfo = Router.prepareUserInfoForNewVoter({
            userOptions,
            twilioPhoneNumber,
            entryPoint,
            returningVoter,
          });
  
          await Router.welcomePotentialVoter(
            userInfo,
            userOptions,
            redisClient,
            twilioPhoneNumber,
            inboundDbMessageEntry,
            entryPoint,
            twilioCallbackURL
          );
          break;
        case ConstituentStatus.PRE_ENTERING_AUTOMATED:
          await Router.clarifyHelplineRequest(
            { userInfo: userInfo!, userPhoneNumber, userAttachments, userMessage },
            redisClient,
            twilioPhoneNumber,
            inboundDbMessageEntry,
            twilioCallbackURL
          );
          break;
        case ConstituentStatus.ENTERING:
          let includeWelcome = false;
          if (!userInfo) {
            includeWelcome = true;
            let userOptions = {
              userPhoneNumber,
              userMessage,
              userAttachments,
              userId,
            };
            userInfo = Router.prepareUserInfoForNewVoter({
              userOptions,
              twilioPhoneNumber,
              entryPoint,
              returningVoter,
            });
          }

          await Router.handleNewVoter(
            userInfo!,
            { userPhoneNumber, userMessage, userAttachments, userId },
            redisClient,
            twilioPhoneNumber,
            inboundDbMessageEntry,
            entryPoint,
            twilioCallbackURL,
            // If this is a first-time texter we've never seen before, we should welcome them
            // as part of the automated response text.
            includeWelcome
          );

          break;
        case ConstituentStatus.HAS_ENTERED_AUTOMATED:
          const isVotedKeyword = KeywordParser.isVotedKeyword(userMessage);
          if (isVotedKeyword) {
            await Router.recordVotedStatus(userInfo!, twilioPhoneNumber);
          }
          if (isVotedKeyword) {
            await Router.replyToVoted(
              userInfo!,
              twilioPhoneNumber,
              twilioCallbackURL,
              userMessage,
              inboundDbMessageEntry
            );
          } else {
            logger.info(
              `SERVER.handleIncomingTwilioMessage (${userId}): U.S. state for voter is not known. Automated system will attempt to determine.`
            );
            await Router.determineVoterState(
              { userInfo: userInfo!, userPhoneNumber, userMessage, userAttachments },
              redisClient,
              twilioPhoneNumber,
              inboundDbMessageEntry,
              twilioCallbackURL
            );
          }
          break;
        case ConstituentStatus.HAS_ENTERED_CONVERSATION:
          if (KeywordParser.isVotedKeyword(userMessage)
          ) {
            await Router.recordVotedStatus(userInfo!, twilioPhoneNumber);
          }
          logger.info(
            `SERVER.handleIncomingTwilioMessage (${userId}): Known U.S. state for voter (${userInfo!.stateName}) or volunteer has engaged (${userInfo!.volunteerEngaged}). Automated system no longer active.`
          );
          await Router.handleClearedVoter(
            { userInfo: userInfo!, userPhoneNumber, userMessage, userAttachments },
            redisClient,
            twilioPhoneNumber,
            inboundDbMessageEntry,
            twilioCallbackURL
          );
          break;
        case ConstituentStatus.RETURNING:
          if (KeywordParser.isVotedKeyword(userMessage)
          ) {
            await Router.recordVotedStatus(userInfo!, twilioPhoneNumber);
          }
          // Treat this as a new session
          await Router.endVoterSession(
            redisClient,
            userInfo!,
            twilioPhoneNumber
          );
          // TODO: Reconcile this with the userOptions defined above in a separate switch branch.
          userOptions = {
            userPhoneNumber,
            userMessage,
            userAttachments,
            userId,
          };
          userInfo = Router.prepareUserInfoForNewVoter({
            userOptions,
            twilioPhoneNumber,
            entryPoint,
            returningVoter,
          });
  
          await Router.handleNewVoter(
            userInfo,
            userOptions,
            redisClient,
            twilioPhoneNumber,
            inboundDbMessageEntry,
            entryPoint,
            twilioCallbackURL,
            true /* includeWelcome */
          );
          break;
        case ConstituentStatus.UNKNOWN:
          // TODO: Throw some kind of error here.
          return;
      }















    } else {
      // Rejoin?
      if (KeywordParser.isJoinKeyword(userMessage)) {
        const outboundTextsBlocked = await RedisApiUtil.getHashField(
          redisClient,
          'slackBlockedUserPhoneNumbers',
          userPhoneNumber
        );
        if (outboundTextsBlocked) {
          logger.info(
            `SERVER.handleIncomingTwilioMessage: Received JOIN from refused phone number: ${userPhoneNumber}, unblocking.`
          );
          // Start allowing texts to this voter
          await RedisApiUtil.deleteHashField(
            redisClient,
            'slackBlockedUserPhoneNumbers',
            userPhoneNumber
          );
          const MD5 = new Hashes.MD5();
          // TODO: Get rid fo this db write. Rejoin is not a voter status.
          await DbApiUtil.logRejoinStatusToDb(
            MD5.hex(userPhoneNumber),
            userPhoneNumber,
            twilioPhoneNumber,
            LoadBalancer.phoneNumbersAreDemo(twilioPhoneNumber, userPhoneNumber)
          );
          if (userInfo) {
            // Treat this as a new session
            await Router.endVoterSession(
              redisClient,
              userInfo,
              twilioPhoneNumber
            );
            userInfo = null;
            returningVoter = true;
          }
        }
      } else if (
        (process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA' ||
          process.env.CLIENT_ORGANIZATION === 'GADEMS') &&
        KeywordParser.isHelplineKeyword(userMessage)
      ) {
        this.constituentManagementService.handleHelplineFromOptedOutConstituent();
      }

      // Seen this voter before
      if (userInfo != null) {
        logger.info(
          `SERVER.handleIncomingTwilioMessage (${userId}): Voter is known to us (Redis returned userInfo for redisHashKey ${redisHashKey})`
        );

        const outboundTextsBlocked = await this.constituentManagementService.handleKnownVoterBlockLogic(
          userInfo,
          userMessage,
          userPhoneNumber,
          twilioPhoneNumber,
          inboundDbMessageEntry
        );
        if (outboundTextsBlocked) return;

        // Voter is known but has no Slack thread.
        // Context: Certain organizations require an extra step before a Slack
        // thread is created for a voter. In these cases we still record whether
        // we've seen voters, but we may not have an active channel for them.
        if (!('activeChannelId' in userInfo)) {
          logger.info(
            `SERVER.handleIncomingTwilioMessage (${userId}): Voter is known but doesn't have a Slack thread yet.`
          );
          if (
            process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA' ||
            process.env.CLIENT_ORGANIZATION === 'GADEMS'
          ) {
            const userMessageNoPunctuation = userMessage
              .toLowerCase()
              .replace(/[^a-zA-Z]/g, '');
            if (
              userMessageNoPunctuation.startsWith('helpline') ||
              (process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA' &&
                Router.parseStateKeyword(redisClient, userInfo, userMessage))
            ) {
              await Router.handleNewVoter(
                userInfo,
                { userPhoneNumber, userMessage, userAttachments, userId },
                redisClient,
                twilioPhoneNumber,
                inboundDbMessageEntry,
                entryPoint,
                twilioCallbackURL,
                false /* includeWelcome */
              );
              return;
            } else {
              await Router.clarifyHelplineRequest(
                { userInfo, userPhoneNumber, userAttachments, userMessage },
                redisClient,
                twilioPhoneNumber,
                inboundDbMessageEntry,
                twilioCallbackURL
              );
              return;
            }
          } else {
            // For other organizations, all known and unblocked voters should have a Slack thread.
            throw new Error(
              `Redis has a userInfo that unexpectedly doesn't have an activeChannelId (userId: ${userId}, twilioPhoneNumber: ${twilioPhoneNumber})`
            );
          }
        }

        // PUSH
        if (entryPoint === LoadBalancer.PUSH_ENTRY_POINT) {
          logger.info(
            `SERVER.handleIncomingTwilioMessage (${userId}): Skipping automated system since entrypoint is ${LoadBalancer.PUSH_ENTRY_POINT}.`
          );
          // Don't do dislcaimer or U.S. state checks for push voters.
          await Router.handleClearedVoter(
            { userInfo, userAttachments, userPhoneNumber, userMessage },
            redisClient,
            twilioPhoneNumber,
            inboundDbMessageEntry,
            twilioCallbackURL
          );
          // PULL
        } else if (
          userInfo.confirmedDisclaimer ||
          process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA' ||
          process.env.CLIENT_ORGANIZATION === 'GADEMS'
        ) {
          logger.info(
            `SERVER.handleIncomingTwilioMessage (${userId}): Activating automated system since entrypoint is ${LoadBalancer.PULL_ENTRY_POINT}.`
          );
          logger.info(
            `SERVER.handleIncomingTwilioMessage (${userId}): Voter has previously confirmed the disclaimer, or one is not required for this organization.`
          );

          // Always update the status if user texts VOTED, regardless of what mode
          // we are in below.
          if (
            process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA' &&
            KeywordParser.isVotedKeyword(userMessage)
          ) {
            await Router.recordVotedStatus(userInfo, twilioPhoneNumber);
          }

          // Voter has a state determined. The U.S. state name is used for
          // operator messages as well as to know whether a U.S. state is known
          // for the voter. This may not be ideal (create separate bool?).
          // Turn off automated replies if:
          // 1. a volunteer has intervened, or
          // 2. we've asked for their U.S. state too many times.
          if (
            userInfo.stateName ||
            userInfo.volunteerEngaged ||
            userInfo.numStateSelectionAttempts >=
            Router.NUM_STATE_SELECTION_ATTEMPTS_LIMIT
          ) {
            logger.info(
              `SERVER.handleIncomingTwilioMessage (${userId}): Known U.S. state for voter (${userInfo.stateName}) or volunteer has engaged (${userInfo.volunteerEngaged}). Automated system no longer active.`
            );
            await Router.handleClearedVoter(
              { userInfo, userPhoneNumber, userMessage, userAttachments },
              redisClient,
              twilioPhoneNumber,
              inboundDbMessageEntry,
              twilioCallbackURL
            );
            // Voter texted VOTED during the state determination
          } else if (
            process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA' &&
            KeywordParser.isVotedKeyword(userMessage)
          ) {
            await Router.replyToVoted(
              userInfo,
              twilioPhoneNumber,
              twilioCallbackURL,
              userMessage,
              inboundDbMessageEntry
            );
            // Voter has no state determined
          } else {
            logger.info(
              `SERVER.handleIncomingTwilioMessage (${userId}): U.S. state for voter is not known. Automated system will attempt to determine.`
            );
            await Router.determineVoterState(
              { userInfo, userPhoneNumber, userMessage, userAttachments },
              redisClient,
              twilioPhoneNumber,
              inboundDbMessageEntry,
              twilioCallbackURL
            );
          }
        } else {
          logger.info(
            `SERVER.handleIncomingTwilioMessage (${userId}): Activating automated system since entrypoint is ${LoadBalancer.PULL_ENTRY_POINT}`
          );
          logger.info(
            `SERVER.handleIncomingTwilioMessage (${userId}): Voter has NOT previously confirmed the disclaimer. Automated system will attempt to confirm.`
          );
          await Router.handleDisclaimer(
            { userInfo, userPhoneNumber, userMessage, userAttachments },
            redisClient,
            twilioPhoneNumber,
            inboundDbMessageEntry,
            twilioCallbackURL
          );
        }
        // This is the first time we're seeing this voter.
      } else {
        logger.info(
          `SERVER.handleIncomingTwilioMessage (${userId}): Voter is new to us (Redis returned no userInfo for redisHashKey ${redisHashKey})`
        );

        if (KeywordParser.isStopKeyword(userMessage)) {
          logger.info(
            `SERVER.handleIncomingTwilioMessage: Received STOP text from phone number: ${userPhoneNumber}.`
          );
          // Block volunteers or automated system from sending messages to this number in the future,
          // even though there is no thread from which volunteers could do so.
          await RedisApiUtil.setHash(
            redisClient,
            'slackBlockedUserPhoneNumbers',
            {
              [userPhoneNumber]: '1',
            }
          );
          // If the voter's first messsage to us is STOP, ignore any and all subsequent messages.
          await RedisApiUtil.setHash(
            redisClient,
            'twilioBlockedUserPhoneNumbers',
            {
              [userPhoneNumber]: '1',
            }
          );
          // Return so that there is no logging in PG, no Slack thread is created, and
          // no automated response is sent to the voter.
          return;
        }

        const userOptions = {
          userPhoneNumber,
          userMessage,
          userAttachments,
          userId,
        };
        const userInfo = Router.prepareUserInfoForNewVoter({
          userOptions,
          twilioPhoneNumber,
          entryPoint,
          returningVoter,
        });

        if (
          process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA' ||
          process.env.CLIENT_ORGANIZATION === 'GADEMS'
        ) {
          if (
            KeywordParser.isHelplineKeyword(userMessage) ||
            (process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA' &&
              Router.parseStateKeyword(redisClient, userInfo, userMessage))
          ) {
            await Router.handleNewVoter(
              userInfo,
              userOptions,
              redisClient,
              twilioPhoneNumber,
              inboundDbMessageEntry,
              entryPoint,
              twilioCallbackURL,
              true /* includeWelcome */
            );
          } else {
            await Router.welcomePotentialVoter(
              userInfo,
              userOptions,
              redisClient,
              twilioPhoneNumber,
              inboundDbMessageEntry,
              entryPoint,
              twilioCallbackURL
            );
          }
        } else {
          await Router.handleNewVoter(
            userInfo,
            userOptions,
            redisClient,
            twilioPhoneNumber,
            inboundDbMessageEntry,
            entryPoint,
            twilioCallbackURL
          );
        }
      }
    }
  }

  /**
 * Slack requires that you respond to webhooks within 3 seconds. So when
 * responding to Slack webhooks, we kick off a background job and then respond
 * immediately with a 200.
 *
 * How we run background tasks depends on how we're deployed. By default, we
 * just run the task in the background. On Lambda, we instead invoke the
 * worker Lambda function (which runs this same codebase) asynchronously.
 */
  public async enqueueBackgroundTask(
    // These type declarations are a bit complicated -- basically, this is saying
    // that `taskName` must be one of the keys of BACKGROUND_TASKS, and that
    // `args` must match the arguments of that function
    taskName: keyof typeof this.BACKGROUND_TASKS,
    ...args: Parameters<(typeof this.BACKGROUND_TASKS)[typeof taskName]>
  ): Promise<void> {
    if (process.env.LAMBDA_BACKGROUND_TASK_FUNCTION) {
      // We require and instantiate the lambda client here rather than
      // at the top of the file so that we don't require aws-sdk in non-lambda
      // environment -- it's a very large library and it's included by default
      // in the Lambda environment so we don't need to declare it as a
      // dependency
  
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const AWS = require('aws-sdk');
      const lambda = new AWS.Lambda();
  
      // use an async lambda invocation to run the background task
      logger.info(
        `Running background task ${taskName} via async lambda invocation`
      );
      const result = await lambda
        .invoke({
          FunctionName: process.env.LAMBDA_BACKGROUND_TASK_FUNCTION,
          Payload: JSON.stringify({
            taskName,
            args,
          }),
          InvocationType: 'Event',
        })
        .promise();
      logger.info(`Invoke result: ${result.StatusCode}`);
    } else {
      // just run the function, but don't await the promise so we don't block
      // on completion
      logger.info(`Running background task ${taskName} as a background promise`);
  
      // @ts-ignore Typescript can't follow this kind of dynamic function call
      this.BACKGROUND_TASKS[taskName](...args).catch((err) => {
        logger.error(err);
        Sentry.captureException(err);
      });
    }
  }
  
  public backgroundLambdaHandler = wrapLambdaHandlerForSentry(
    async (event: any): Promise<void> => {
      logger.info(
        `Running Lambda background function with payload: ${JSON.stringify(
          event
        )}`
      );
  
      const { taskName, args } = event;
  
      if (!(taskName in this.BACKGROUND_TASKS)) {
        throw new Error(`Got an invalid task name: ${taskName}`);
      }
  
      // @ts-ignore Typescript can't check this -- everything's coming in from the
      // dynamic payload
      await BACKGROUND_TASKS[taskName](...args);
    }
  );
}

// TODO: Update this to allow constructors to take arguments. See discussion "JS AWS Lambda + Constructor Use."
// Used by serverless.yml.
const agentManagementServiceInstance = new AgentManagementService();
const constituentManagementServiceInstance = new ConstituentManagementService();
const dbServiceInstance = new DbService();
const serviceCoordinatorInstance = new ServiceCoordinator(constituentManagementServiceInstance, agentManagementServiceInstance, dbServiceInstance);
module.exports.backgroundLambdaHandler = serviceCoordinatorInstance.backgroundLambdaHandler.bind(serviceCoordinatorInstance);
