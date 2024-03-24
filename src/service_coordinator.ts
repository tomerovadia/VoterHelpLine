import Hashes from 'jshashes';

import { EntryPoint, Request, UserInfo, ConstituentStatus } from './types';
import { TwilioRequestBody } from './twilio_util';
import redisClient from './redis_client';
import * as TwilioUtil from './twilio_util';
import * as LoadBalancer from './load_balancer';
// TODO: Remove ServiceCoordinator's dependency on Router.
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
import * as MessageConstants from './message_constants';
import * as DbApiUtil from './db_api_util';
import * as RedisApiUtil from './redis_api_util';

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
    await this.agentManagementService.handleSlackInteractivity(payload, metadata);
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

  // Method to handle incoming SMS messages.
  public async handleIncomingSmsMessage(
    req: Request,
    // TODO: Return a status of some kind, instead of void.
    entryPoint: EntryPoint
  ): Promise<void> {
    logger.info('Entering ServiceCoordinator.handleIncomingSmsMessage');

    const reqBody = req.body as TwilioRequestBody;
    const userPhoneNumber = reqBody.From;

    // TODO: Have the logic within this block encapsulated within a method of constituentManagementService,
    // so that clients can modify the behavior (e.g. reply with unsubscribe confirmation).
    // Have this be one of the major paths (with constitutent status STOP).
    if (await this.agentManagementService.isPhoneNumberBlocked(userPhoneNumber)) {
      logger.info(
        `ServiceCoordinator.handleIncomingSmsMessage: Received text from blocked phone number: ${userPhoneNumber}.`
      );
      return;
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
    logger.info(`ServiceCoordinator.handleIncomingSmsMessage: Receiving Twilio message from ${entryPoint} entry point voter,
                          userPhoneNumber: ${userPhoneNumber},
                          twilioPhoneNumber: ${twilioPhoneNumber},
                          userMessage: ${userMessage},
                          userId: ${userId}`);

    const inboundDbMessageEntry = this.dbService.populateInitialIncomingConstituentMessageDbEntry({
      userMessage,
      userPhoneNumber,
      twilioPhoneNumber,
      twilioMessageSid: reqBody.SmsMessageSid,
      twilioAttachments: userAttachments,
      entryPoint: LoadBalancer.PUSH_ENTRY_POINT,
    });
    this.constituentManagementService.setInboundDbMessageEntry(inboundDbMessageEntry);

    let returningVoter = false;
    let userInfo = await this.constituentManagementService.fetchAndLoadConstituentInfo(twilioPhoneNumber);
    if (!userInfo) {
      userInfo = this.constituentManagementService.loadInfoForNewConstituent({
        userPhoneNumber,
        constituentId: userId,
        twilioPhoneNumber,
        entryPoint,
      });
    }
    await this.constituentManagementService.fetchAndLoadOptOutStatus();
    this.constituentManagementService.determineConstituentStatus();
    if (config.enableMultiCycleFeature && this.constituentManagementService.getConstituentStatus() == ConstituentStatus.RETURNING) {
      await this.agentManagementService.endVoterSession(redisClient, userInfo, twilioPhoneNumber);
    }

    logger.info("ServiceCoordinator.handleIncomingSmsMessage ConstituentStatus: ", this.constituentManagementService.getConstituentStatus());
    const constituentIsAllowedToContinue = await this.constituentManagementService.handleOptOutLogic(twilioPhoneNumber, inboundDbMessageEntry);
    if (!constituentIsAllowedToContinue) return;

    let userOptions;
    switch (this.constituentManagementService.getConstituentStatus()) {
      /********************
        NEW
      ********************/
      case ConstituentStatus.NEW: {
        //T OK TO KEEP THIS MESSAGE LOGIC HERE FOR NOW
        let messageToVoter = MessageConstants.WELCOME_VOTER();
        if (KeywordParser.isVotedKeyword(userMessage)) {
          messageToVoter = MessageConstants.VOTED_WELCOME_RESPONSE();

          //T Should this pull from userinfo or User somewhere else?
          //T Should there be one version of userinfo stored somewhere, and if so where?
          await DbApiUtil.logVoterStatusToDb({
            userId: userInfo.userId,
            userPhoneNumber: userInfo.userPhoneNumber,
            twilioPhoneNumber: twilioPhoneNumber,
            isDemo: userInfo.isDemo,
            voterStatus: 'VOTED',
            originatingSlackUserName: null,
            originatingSlackUserId: null,
            slackChannelName: null,
            slackChannelId: null,
            slackParentMessageTs: null,
            actionTs: null,
          });
        }

        await this.constituentManagementService.sendMessageToConstituent({
          message: messageToVoter,
          automated: true
        });

        DbApiUtil.updateDbMessageEntryWithUserInfo(userInfo!, inboundDbMessageEntry);

        // The message isn't being relayed, so don't fill this field in Postgres.
        inboundDbMessageEntry.successfullySent = null;
        try {
          // TODO: Use dbService for this intead.
          await DbApiUtil.logMessageToDb(inboundDbMessageEntry);
        } catch (error) {
          logger.info(
            `ServiceCoordinator.handleIncomingSmsMessage: failed to log incoming voter message to DB`
          );
          Sentry.captureException(error);
        }
      
        // Add key/value such that given a user phone number we can see
        // that the voter has been encountered before, even if there is not
        // yet any Slack channel/thread info for this voter.
        logger.debug(
          `ServiceCoordinator.handleIncomingSmsMessage: Writing new voter userInfo to Redis.`
        );
        await RedisApiUtil.setHash(
          redisClient,
          `${userInfo.userId}:${twilioPhoneNumber}`,
          userInfo
        );
        break;
      }
      /********************
        PRE_ENTERING_AUTOMATED
      ********************/
      case ConstituentStatus.PRE_ENTERING_AUTOMATED: {
        let messageToVoter = MessageConstants.CLARIFY_HELPLINE_REQUEST();
        if (KeywordParser.isVotedKeyword(userMessage)) {
          messageToVoter = MessageConstants.VOTED_WELCOME_RESPONSE();
          await DbApiUtil.logVoterStatusToDb({
            userId: userInfo.userId,
            userPhoneNumber: userInfo.userPhoneNumber,
            twilioPhoneNumber: twilioPhoneNumber,
            isDemo: userInfo.isDemo,
            voterStatus: 'VOTED',
            originatingSlackUserName: null,
            originatingSlackUserId: null,
            slackChannelName: null,
            slackChannelId: null,
            slackParentMessageTs: null,
            actionTs: null,
          });
        }
      
        await this.constituentManagementService.sendMessageToConstituent({
          message: messageToVoter,
          automated: true
        });
      
        // The rest of this logic is the same as the NEW case. Consider consolidating somehow.
        DbApiUtil.updateDbMessageEntryWithUserInfo(userInfo!, inboundDbMessageEntry);
      
        // The message isn't being relayed, so don't fill this field in Postgres.
        inboundDbMessageEntry.successfullySent = null;
        try {
          // TODO: Use dbService for this intead.
          await DbApiUtil.logMessageToDb(inboundDbMessageEntry);
        } catch (error) {
          logger.info(
            `ROUTER.clarifyHelplineRequest: failed to log incoming voter message to DB`
          );
          Sentry.captureException(error);
        }
      
        // Update Redis Twilio-to-Slack lookup.
        logger.debug(
          `ROUTER.clarifyHelplineRequest: Updating voter userInfo in Redis.`
        );
        await RedisApiUtil.setHash(
          redisClient,
          `${userInfo.userId}:${twilioPhoneNumber}`,
          userInfo
        );

        break;
      }
      /********************
        ENTERING
      ********************/
      case ConstituentStatus.ENTERING: {
        await DbApiUtil.logInitialVoterStatusToDb(
          userInfo.userId,
          userInfo.userPhoneNumber,
          twilioPhoneNumber,
          userInfo.isDemo
        );
      
        let slackChannelName;
        if ((await RedisApiUtil.getKey(redisClient, 'skipLobby')) === 'true') {
          slackChannelName = null;
        } else {
          slackChannelName = userInfo.isDemo ? 'demo-lobby' : 'lobby' as string | null;
        }
        let stateName;
      
        // Can we infer the voter's state from their phone number?
        // TODO: Handle this in the determineConstituentStatus function in ConstituentManagementService.
        if (
          config.enableKnownStateFromPhoneNumber
        ) {
          stateName = this.constituentManagementService.fetchAndLoadKnownState();
          if (stateName) {
            const stateChannel = await LoadBalancer.selectSlackChannel(
              redisClient,
              LoadBalancer.PULL_ENTRY_POINT,
              userInfo.stateName,
              userInfo.isDemo
            );
            if (stateChannel) {
              // We can route them too
              slackChannelName = stateChannel;
              logger.info(
                `ROUTER.handleNewVoter (${userInfo.userId}): New voter is in known state ${stateName}, selected Slack channel ${slackChannelName}`
              );
            } else {
              // That state doesn't route for some reason; go to lobby.
              logger.warning(
                `ROUTER.handleNewVoter (${userInfo.userId}): New voter is in known state ${stateName}, but no channel match`
              );
            }
          }
        }

        // If the voter has previously communicated that they already voted, we have them
        // enter the helpline with "Voted" prepopulated as their status.
        const status = await DbApiUtil.getLatestVoterStatus(
          userInfo.userId,
          twilioPhoneNumber
        );

        let messageToConstituent;
        if (!this.constituentManagementService.isConstituentKnown()) {
          // Voter initiated conversation with "HELPLINE".
          if (userInfo.stateName) {
            messageToConstituent = MessageConstants.WELCOME_FINDING_VOLUNTEER(
              userInfo.stateName
            );
          } else {
            messageToConstituent = MessageConstants.WELCOME_AND_STATE_QUESTION();
          }
        } else {
          // Voter has already received automated welcome and is just now responding with "HELPLINE".
          if (userInfo.stateName) {
            messageToConstituent = MessageConstants.FINDING_VOLUNTEER_IN_STATE(
              userInfo.stateName
            );
          } else {
            messageToConstituent = MessageConstants.STATE_QUESTION();
          }
        }

        let slackParentMessageResponse;
        if (slackChannelName) {
          const topLevelThreadSlackBlocks = await SlackBlockUtil.getVoterPanel(
            userInfo,
            twilioPhoneNumber,
            undefined,
            status || 'UNKNOWN'
          );

          try {
            slackParentMessageResponse = await SlackApiUtil.sendMessage(topLevelThreadSlackBlocks[0].text.text, {
              channel: slackChannelName,
              blocks: topLevelThreadSlackBlocks,
            });
          } catch(error) {
            await this.constituentManagementService.sendMessageToConstituent({
              message: `There was an unexpected error sending your message. Please wait a few minutes and try again.`,
              automated: true
            });
            throw new Error(
              `Could not send introduction slack message with voter info for voter ${userInfo.userPhoneNumber} texting ${twilioPhoneNumber}. Error: ${error}`
            );
          }

          // This should never be null because SlackApiUtil.sendMessage always either returns a successful
          // response or throws an error, which would be caught above.
          // TODO: We should consolidate this with the error catch above.
          if (!slackParentMessageResponse) {
            await this.constituentManagementService.sendMessageToConstituent({
              message: `There was an unexpected error sending your message. Please wait a few minutes and try again.`,
              automated: true
            });
            throw new Error(
              `Could not send introduction slack message with voter info for voter ${userInfo.userPhoneNumber} texting ${twilioPhoneNumber}.`
            );
          }

          await this.constituentManagementService.sendMessageToConstituent({
            message: messageToConstituent,
            automated: true
          });

          logger.debug(`ROUTER.introduceNewVoterToSlackChannel: Successfully announced new voter via new thread in ${slackChannelName},
            response.data.channel: ${slackParentMessageResponse.data.channel},
            response.data.ts: ${slackParentMessageResponse.data.ts}`);

          await DbApiUtil.logThreadToDb({
            slackParentMessageTs: slackParentMessageResponse.data.ts,
            channelId: slackParentMessageResponse.data.channel,
            userId: userInfo.userId,
            userPhoneNumber: userInfo.userPhoneNumber,
            twilioPhoneNumber: twilioPhoneNumber,
            needsAttention: true,
            isDemo: userInfo.isDemo,
            sessionStartEpoch: userInfo.sessionStartEpoch || null,
          });

          // Remember the thread for this user and this channel,
          // using the ID version of the channel.
          userInfo[slackParentMessageResponse.data.channel] = slackParentMessageResponse.data.ts;
          // Set active channel to this first channel, since the voter is new.
          // Makes sure subsequent messages from the voter go to this channel, unless
          // this active channel is changed.
          userInfo.activeChannelId = slackParentMessageResponse.data.channel;
          userInfo.activeChannelName = slackChannelName;
          inboundDbMessageEntry.slackChannel = slackParentMessageResponse.data.channel;
          inboundDbMessageEntry.slackParentMessageTs = slackParentMessageResponse.data.ts;
          DbApiUtil.updateDbMessageEntryWithUserInfo(
            userInfo!,
            inboundDbMessageEntry
          );
          inboundDbMessageEntry.slackChannel = slackParentMessageResponse.data.channel;
          inboundDbMessageEntry.slackParentMessageTs = slackParentMessageResponse.data.ts;
          inboundDbMessageEntry.slackSendTimestamp = new Date();
          // The message will be relayed via the message history, so this field isn't relevant.
          inboundDbMessageEntry.successfullySent = null;
          try {
            await DbApiUtil.logMessageToDb(inboundDbMessageEntry);
          } catch (error) {
            logger.info(
              `ROUTER.introduceNewVoterToSlackChannel: failed to log incoming voter message to DB`
            );
            Sentry.captureException(error);
          }
          await Router.postUserMessageHistoryToSlack(
            redisClient,
            userInfo,
            twilioPhoneNumber,
            {
              destinationSlackParentMessageTs: slackParentMessageResponse.data.ts,
              destinationSlackChannelId: slackParentMessageResponse.data.channel,
            }
          );
          // Add key/value such that given a user phone number we can get the
          // Slack channel thread associated with that user.
          logger.debug(
            `ROUTER.introduceNewVoterToSlackChannel: Writing updated userInfo to Redis.`
          );
          await RedisApiUtil.setHash(
            redisClient,
            `${userInfo.userId}:${twilioPhoneNumber}`,
            userInfo
          );
  
          // Add key/value such that given Slack thread data we can get a
          // user phone number.
          logger.debug(
            `ROUTER.introduceNewVoterToSlackChannel: Writing updated Slack-to-Twilio redisData to Redis.`
          );
          await RedisApiUtil.setHash(
            redisClient,
            `${slackParentMessageResponse.data.channel}:${slackParentMessageResponse.data.ts}`,
            { userPhoneNumber: userInfo.userPhoneNumber, twilioPhoneNumber }
          );
          // Add key/value such that given Slack thread data we can get a
          // user phone number.
          logger.debug(
            `ROUTER.introduceNewVoterToSlackChannel: Writing updated Slack-to-Twilio redisData to Redis.`
          );
          await RedisApiUtil.setHash(
            redisClient,
            `${slackParentMessageResponse.data.channel}:${slackParentMessageResponse.data.ts}`,
            { userPhoneNumber: userInfo.userPhoneNumber, twilioPhoneNumber }
          );
        } else {
          await this.constituentManagementService.sendMessageToConstituent({
            message: messageToConstituent,
            automated: true
          });
          userInfo["NONEXISTENT_LOBBY"] = "NONEXISTENT_LOBBY_TS";
          // Set active channel to this first channel, since the voter is new.
          // Makes sure subsequent messages from the voter go to this channel, unless
          // this active channel is changed.
          userInfo.activeChannelId = "NONEXISTENT_LOBBY";
          userInfo.activeChannelName = "lobby";
          inboundDbMessageEntry.slackChannel = "NONEXISTENT_LOBBY"
          inboundDbMessageEntry.slackParentMessageTs = "NONEXISTENT_LOBBY_TS";
          inboundDbMessageEntry.slackSendTimestamp = new Date();
          // The message will be relayed via the message history, so this field isn't relevant.
          inboundDbMessageEntry.successfullySent = null;
          try {
            await DbApiUtil.logMessageToDb(inboundDbMessageEntry);
          } catch (error) {
            logger.info(
              `ROUTER.introduceNewVoterToSlackChannel: failed to log incoming voter message to DB`
            );
            Sentry.captureException(error);
          }
        }

        // Add key/value such that given a user phone number we can get the
        // Slack channel thread associated with that user.
        logger.debug(
          `ROUTER.introduceNewVoterToSlackChannel: Writing updated userInfo to Redis.`
        );
        await RedisApiUtil.setHash(
          redisClient,
          `${userInfo.userId}:${twilioPhoneNumber}`,
          userInfo
        );

        break;
      }
      /********************
        HAS_ENTERED_AUTOMATED
      ********************/
      case ConstituentStatus.HAS_ENTERED_AUTOMATED: {
        if (KeywordParser.isVotedKeyword(userMessage)) {
          await Router.recordVotedStatus(userInfo!, twilioPhoneNumber);
          await Router.replyToVoted(
            userInfo!,
            twilioPhoneNumber,
            twilioCallbackURL,
            userMessage,
            inboundDbMessageEntry
          );
        } else {
          logger.info(
            `ServiceCoordinator.handleIncomingSmsMessage (${userId}): U.S. state for voter is not known. Automated system will attempt to determine.`
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
      }
      /********************
        HAS_ENTERED_CONVERSATION
      ********************/
      case ConstituentStatus.HAS_ENTERED_CONVERSATION: {
        if (KeywordParser.isVotedKeyword(userMessage)
        ) {
          await Router.recordVotedStatus(userInfo!, twilioPhoneNumber);
        }
        logger.info(
          `ServiceCoordinator.handleIncomingSmsMessage (${userId}): Known U.S. state for voter (${userInfo!.stateName}) or volunteer has engaged (${userInfo!.volunteerEngaged}). Automated system no longer active.`
        );
        await Router.handleClearedVoter(
          { userInfo: userInfo!, userPhoneNumber, userMessage, userAttachments },
          redisClient,
          twilioPhoneNumber,
          inboundDbMessageEntry,
          twilioCallbackURL
        );
        break;
      }
      /********************
        RETURNING
      ********************/
      case ConstituentStatus.RETURNING: {
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
      }
      /********************
        UNKNOWN
      ********************/
      case ConstituentStatus.UNKNOWN: {
        // TODO: Throw some kind of error here.
        return;
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
// const agentManagementServiceInstance = new AgentManagementService();
// const constituentManagementServiceInstance = new ConstituentManagementService();
// const dbServiceInstance = new DbService();
// const serviceCoordinatorInstance = new ServiceCoordinator(constituentManagementServiceInstance, agentManagementServiceInstance, dbServiceInstance);
// module.exports.backgroundLambdaHandler = serviceCoordinatorInstance.backgroundLambdaHandler.bind(serviceCoordinatorInstance);
