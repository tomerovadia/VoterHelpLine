import Hashes from 'jshashes';

import { EntryPoint, Request, UserInfo, ConstituentStatus, SessionTopics } from './types';
import { TwilioRequestBody } from './twilio_util';
import redisClient from './redis_client';
import * as TwilioUtil from './twilio_util';
import * as LoadBalancer from './load_balancer';
import * as KeywordParser from './keyword_parser';
import * as SlackApiUtil from './slack_api_util';
import AgentManagementService from './agent_management_service';
import ConstituentManagementService from './constituent_management_service';
import logger from './logger';
import * as SlackInteractionApiUtil from './slack_interaction_api_util';
import * as SlackBlockUtil from './slack_block_util';
import { SlackCallbackId } from './slack_interaction_ids';
import { SlackInteractionEventPayload } from './slack_interaction_handler';
import * as SlackInteractionHandler from './slack_interaction_handler';
import * as Sentry from '@sentry/node';
import * as SlackMessageFormatter from './slack_message_formatter';
import { wrapLambdaHandlerForSentry } from './sentry_wrapper';
import DbService from './db_service';
import config from './config';
import { isVotedKeyword } from './keyword_parser';
import * as MessageConstants from './message_constants';
import { PromisifiedRedisClient } from './redis_client';
import { SlackActionId } from './slack_interaction_ids';
import * as DbApiUtil from './db_api_util';
import * as RedisApiUtil from './redis_api_util';
import * as StateParser from './state_parser';
import { SlackFile } from './message_parser';

const MINS_BEFORE_WELCOME_BACK_MESSAGE = 60 * 24;
export const NUM_STATE_SELECTION_ATTEMPTS_LIMIT = 2;

export type InteractivityHandlerMetadata = { viewId?: string };

type UserOptions = {
  userMessage: string;
  userAttachments: string[];
  userPhoneNumber: string;
};

export type SlackEventRequestBody = {
  event: {
    type: string;
    hidden: boolean;
    text: string;
    ts: string;
    thread_ts: string;
    user: string;
    channel: string;
    files?: SlackFile[];
  };
  authed_users: string[];
};

export type AdminCommandParams = {
  commandParentMessageTs: string | null;
  commandMessageTs: string | null; // if command is in a thread, this is the in-thread message
  commandChannel: string | null;
  routingSlackUserName: string;
  previousSlackChannelName: string;
};


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
  ) {
    this.constituentManagementService = constituentManagementService;
    this.agentManagementService = agentManagementService;
    this.dbService = dbService;
  }

  private BACKGROUND_TASKS = {
    handleIncomingSlackCommand: this.handleIncomingSlackCommand.bind(this),
    handleSlackInteractivity: this.handleSlackInteractivity.bind(this),
    handleIncomingSlackMessageEvent: this.handleIncomingSlackMessageEvent.bind(this),
    handleIncomingSlackAppMentionEvent: this.handleIncomingSlackAppMentionEvent.bind(this)
  };

  /***********************
    SLACK METHODS
  ************************/

  // Method to handle incoming messages from Slack.
  public async handleIncomingSlackMessageEvent(reqBody: SlackEventRequestBody,
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
  public async handleIncomingSlackAppMentionEvent(reqBody: SlackEventRequestBody): Promise<void> {
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
  // can't be listed in BACKGROUND_TASKS directly.
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

  /***********************
    HELPER METHODS
  ************************/

  async introduceNewVoterToSlackChannel(
    {
      userInfo,
      userMessage,
      userAttachments,
    }: { userInfo: UserInfo; userMessage: string; userAttachments: string[] },
    redisClient: PromisifiedRedisClient,
    twilioPhoneNumber: string,
    inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry | null,
    entryPoint: EntryPoint,
    slackChannelName: string,
    twilioCallbackURL: string,
    // This is only used by VOTE_AMERICA
    includeWelcome?: boolean,
    noWelcome?: boolean
  ): Promise<string> {
    logger.debug('ENTERING ServiceCoordinator.introduceNewVoterToSlackChannel');
    logger.debug(
      `ServiceCoordinator.introduceNewVoterToSlackChannel: Updating lastVoterMessageSecsFromEpoch to ${userInfo.lastVoterMessageSecsFromEpoch}`
    );

    logger.debug(
      `ServiceCoordinator.introduceNewVoterToSlackChannel: Announcing new voter via new thread in ${slackChannelName}.`
    );

    // If the voter has previously communicated that they already voted, we have them
    // enter the helpline with "Voted" prepopulated as their status.
    const status = await DbApiUtil.getLatestVoterStatus(
      userInfo.userId,
      twilioPhoneNumber
    );

    const slackBlocks = await SlackBlockUtil.getVoterPanel(
      userInfo,
      twilioPhoneNumber,
      undefined,
      status || 'UNKNOWN'
    );

    const skipLobby =
      (await RedisApiUtil.getKey(redisClient, 'skipLobby')) === 'true';

    let response = {
      data: {
        channel: 'NONEXISTENT_LOBBY',
        ts: 'NONEXISTENT_LOBBY_TS',
      },
    } as SlackApiUtil.SlackSendMessageResponse | null;

    if (slackChannelName !== 'lobby' || !skipLobby) {
      response = await SlackApiUtil.sendMessage(slackBlocks[0].text.text, {
        channel: slackChannelName,
        blocks: slackBlocks,
      });
    }

    let messageToVoter;
    if (
      process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA' ||
      process.env.CLIENT_ORGANIZATION === 'GADEMS'
    ) {
      if (includeWelcome) {
        // Voter initiated conversation with "HELPLINE".
        if (userInfo.stateName) {
          messageToVoter = MessageConstants.WELCOME_FINDING_VOLUNTEER(
            userInfo.stateName
          );
        } else {
          messageToVoter = MessageConstants.WELCOME_AND_STATE_QUESTION();
        }
      } else {
        // Voter has already received automated welcome and is just now responding with "HELPLINE".
        if (userInfo.stateName) {
          messageToVoter = MessageConstants.FINDING_VOLUNTEER_IN_STATE(
            userInfo.stateName
          );
        } else {
          messageToVoter = MessageConstants.STATE_QUESTION();
        }
      }
    } else {
      messageToVoter = MessageConstants.WELCOME_VOTER();
    }

    if (response) {
      if (!noWelcome && entryPoint === LoadBalancer.PULL_ENTRY_POINT) {
        logger.debug(
          `ServiceCoordinator.introduceNewVoterToSlackChannel: Entry point is PULL, so sending automated welcome to voter.`
        );
        // Welcome the voter
        await this.constituentManagementService.sendMessageToConstituent({
          message: messageToVoter,
          automated: true
        });
      }
    } else {
      await this.constituentManagementService.sendMessageToConstituent({
        message: `There was an unexpected error sending your message. Please wait a few minutes and try again.`,
        automated: true
      });
      throw new Error(
        `Could not send introduction slack message with voter info for voter ${userInfo.userPhoneNumber} texting ${twilioPhoneNumber}`
      );
    }

    logger.debug(`ServiceCoordinator.introduceNewVoterToSlackChannel: Successfully announced new voter via new thread in ${slackChannelName},
                    response.data.channel: ${response.data.channel},
                    response.data.ts: ${response.data.ts}`);

    // Remember the thread for this user and this channel,
    // using the ID version of the channel.
    userInfo[response.data.channel] = response.data.ts;

    // Create the thread
    if (!skipLobby) {
      await DbApiUtil.logThreadToDb({
        slackParentMessageTs: response.data.ts,
        channelId: response.data.channel,
        userId: userInfo.userId,
        userPhoneNumber: userInfo.userPhoneNumber,
        twilioPhoneNumber: twilioPhoneNumber,
        needsAttention: true,
        isDemo: userInfo.isDemo,
        sessionStartEpoch: userInfo.sessionStartEpoch || null,
      });
    }

    // Set active channel to this first channel, since the voter is new.
    // Makes sure subsequent messages from the voter go to this channel, unless
    // this active channel is changed.
    userInfo.activeChannelId = response.data.channel;
    userInfo.activeChannelName = slackChannelName;

    // Depending on the entry point, either:
    // PULL: Pass user message to Slack and then automated reply.
    // PUSH/some clients: Write user reply to database and then pass message history to Slack.
    if (
      entryPoint === LoadBalancer.PUSH_ENTRY_POINT ||
      process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA'
    ) {
      logger.debug(
        `ServiceCoordinator.introduceNewVoterToSlackChannel: Retrieving and passing message history to Slack, slackChannelName: ${slackChannelName}, parentMessageTs: ${response.data.channel}.`
      );

      if (!inboundDbMessageEntry) {
        logger.debug(
          `ServiceCoordinator.introduceNewVoterToSlackChannel: reopen empty session thread, slackChannelName: ${slackChannelName}, parentMessageTs: ${response.data.channel}.`
        );
      } else {
        DbApiUtil.updateDbMessageEntryWithUserInfo(
          userInfo!,
          inboundDbMessageEntry
        );
        inboundDbMessageEntry.slackChannel = response.data.channel;
        inboundDbMessageEntry.slackParentMessageTs = response.data.ts;
        inboundDbMessageEntry.slackSendTimestamp = new Date();
        // The message will be relayed via the message history, so this field isn't relevant.
        inboundDbMessageEntry.successfullySent = null;
        try {
          await DbApiUtil.logMessageToDb(inboundDbMessageEntry);
        } catch (error) {
          logger.info(
            `ServiceCoordinator.introduceNewVoterToSlackChannel: failed to log incoming voter message to DB`
          );
          Sentry.captureException(error);
        }
      }

      if (slackChannelName !== 'lobby' || !skipLobby) {
        await this.postUserMessageHistoryToSlack(
          redisClient,
          userInfo,
          twilioPhoneNumber,
          {
            destinationSlackParentMessageTs: response.data.ts,
            destinationSlackChannelId: response.data.channel,
          }
        );
      }
    } else if (entryPoint === LoadBalancer.PULL_ENTRY_POINT) {
      // Pass the voter's message along to the initial Slack channel thread,
      // and show in the Slack thread the welcome message the voter received
      // in response.
      logger.debug(
        `ServiceCoordinator.introduceNewVoterToSlackChannel: Passing voter message to Slack, slackChannelName: ${slackChannelName}, parentMessageTs: ${response.data.ts}.`
      );
      if (inboundDbMessageEntry) {
        const blocks = SlackBlockUtil.formatMessageWithAttachmentLinks(
          userMessage,
          userAttachments
        );
        await SlackApiUtil.sendMessage(
          blocks[0].text.text,
          {
            parentMessageTs: response.data.ts,
            blocks,
            channel: response.data.channel,
            isVoterMessage: true,
          },
          inboundDbMessageEntry,
          userInfo
        );
      }

      logger.debug(
        `ServiceCoordinator.introduceNewVoterToSlackChannel: Passing automated welcome message to Slack, slackChannelName: ${slackChannelName}, parentMessageTs: ${response.data.channel}.`
      );
      await SlackApiUtil.sendMessage(messageToVoter, {
        parentMessageTs: response.data.ts,
        channel: response.data.channel,
        isAutomatedMessage: true,
      });
    }

    // Add key/value such that given a user phone number we can get the
    // Slack channel thread associated with that user.
    logger.debug(
      `ServiceCoordinator.introduceNewVoterToSlackChannel: Writing updated userInfo to Redis.`
    );
    await RedisApiUtil.setHash(
      redisClient,
      `${userInfo.userId}:${twilioPhoneNumber}`,
      userInfo
    );

    // Add key/value such that given Slack thread data we can get a
    // user phone number.
    logger.debug(
      `ServiceCoordinator.introduceNewVoterToSlackChannel: Writing updated Slack-to-Twilio redisData to Redis.`
    );
    await RedisApiUtil.setHash(
      redisClient,
      `${response.data.channel}:${response.data.ts}`,
      { userPhoneNumber: userInfo.userPhoneNumber, twilioPhoneNumber }
    );
    return response.data.ts;
  }

  async handleNewVoter(
    userInfo: UserInfo,
    userOptions: UserOptions & { userId: string },
    redisClient: PromisifiedRedisClient,
    twilioPhoneNumber: string,
    inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry,
    entryPoint: EntryPoint,
    twilioCallbackURL: string,
    includeWelcome?: boolean
  ): Promise<void> {
    logger.debug('ENTERING ServiceCoordinator.handleNewVoter');
    const userMessage = userOptions.userMessage;

    await DbApiUtil.logInitialVoterStatusToDb(
      userInfo.userId,
      userOptions.userPhoneNumber,
      twilioPhoneNumber,
      userInfo.isDemo
    );

    let slackChannelName = null as string | null;

    if (process.env.CLIENT_ORGANIZATION === 'GADEMS') {
      userInfo.stateName = 'Georgia';
    }

    // Can we infer the voter's state from their phone number?
    if (
      process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA' &&
      !userInfo.stateName
    ) {
      const knownState = await DbApiUtil.getKnownPhoneState(
        userOptions.userPhoneNumber
      );
      if (knownState) {
        // The knownState value from the db is probably a state abbreviation, so we need to resolve it
        const stateName = StateParser.determineState(knownState);
        if (stateName) {
          // Success: we know the state
          userInfo.stateName = stateName;
          userInfo.panelmessage = 'known phone number';
        } else {
          logger.warning(
            `ServiceCoordinator.handleNewVoter (${userInfo.userId}): unable to parse known state '${knownState}`
          );
        }
      }
    }

    // userInfo.stateName may be populated above, or by parseStateKeyword
    if (userInfo.stateName) {
      slackChannelName = await LoadBalancer.selectSlackChannel(
        redisClient,
        LoadBalancer.PULL_ENTRY_POINT,
        userInfo.stateName,
        userInfo.isDemo
      );
      if (slackChannelName) {
        // We can route them too
        logger.info(
          `ServiceCoordinator.handleNewVoter (${userInfo.userId}): New voter is in known state ${userInfo.stateName}, selected Slack channel ${slackChannelName}`
        );
      } else {
        // That state doesn't route for some reason; go to national
        slackChannelName = userInfo.isDemo ? 'demo-national' : 'national';
        logger.info(
          `ServiceCoordinator.handleNewVoter (${userInfo.userId}): New voter is in known state ${userInfo.stateName}, but no channel match`
        );
      }
    }

    if (!slackChannelName) {
      slackChannelName = userInfo.isDemo ? 'demo-lobby' : 'lobby';
      if (entryPoint === LoadBalancer.PULL_ENTRY_POINT) {
        logger.debug(
          `ServiceCoordinator.handleNewVoter (${userInfo.userId}): New voter will enter Slack channel: ${slackChannelName}`
        );
      } else if (entryPoint === LoadBalancer.PUSH_ENTRY_POINT) {
        userInfo.stateName =
          LoadBalancer.getPushPhoneNumberState(twilioPhoneNumber);
        logger.debug(
          `ServiceCoordinator.handleNewVoter (${userInfo.userId}): Determined that twilioPhoneNumber ${twilioPhoneNumber} corresponds to U.S. state ${userInfo.stateName} based on hard coding in LoadBalancer.`
        );
        const selectedChannelName = await LoadBalancer.selectSlackChannel(
          redisClient,
          LoadBalancer.PUSH_ENTRY_POINT,
          userInfo.stateName
        );

        logger.debug(
          `ServiceCoordinator.handleNewVoter (${userInfo.userId}): LoadBalancer returned Slack channel ${selectedChannelName} for new PUSH voter.`
        );
        if (selectedChannelName) {
          slackChannelName = selectedChannelName;
        } else {
          // If LoadBalancer didn't find a Slack channel, then select #national or #demo-national as fallback.
          slackChannelName = userInfo.isDemo ? 'demo-national' : 'national';
          logger.error(
            `ServiceCoordinator.handleNewVoter (${userInfo.userId}): ERROR LoadBalancer did not find a Slack channel for new PUSH voter. Using ${slackChannelName} as fallback.`
          );
        }
      }
    }

    await this.introduceNewVoterToSlackChannel(
      {
        userInfo: userInfo as UserInfo,
        userMessage,
        userAttachments: userOptions.userAttachments,
      },
      redisClient,
      twilioPhoneNumber,
      inboundDbMessageEntry,
      entryPoint,
      slackChannelName,
      twilioCallbackURL,
      includeWelcome
    );
  }

  // prepareUserInfoForNewVoter is used by functions that handle
  // phone numbers not previously seen.
  prepareUserInfoForNewVoter({
    userOptions,
    twilioPhoneNumber,
    entryPoint,
    returningVoter,
  }: {
    userOptions: UserOptions & { userId: string; userPhoneNumber: string | null };
    twilioPhoneNumber: string;
    entryPoint: EntryPoint;
    returningVoter: boolean;
  }): UserInfo {
    let isDemo, confirmedDisclaimer, volunteerEngaged;
    if (entryPoint === LoadBalancer.PULL_ENTRY_POINT) {
      isDemo = LoadBalancer.phoneNumbersAreDemo(
        twilioPhoneNumber,
        userOptions.userPhoneNumber
      );
      logger.debug(
        `ServiceCoordinator.prepareUserInfoForNewVoter (${userOptions.userId}): Evaluating isDemo based on userPhoneNumber/twilioPhoneNumber: ${isDemo}`
      );
      confirmedDisclaimer = false;
      volunteerEngaged = false;
    }

    return {
      userId: userOptions.userId,
      twilioPhoneNumber: twilioPhoneNumber,
      // Necessary for admin controls, so userPhoneNumber can be found even though
      // admins specify only userId.
      userPhoneNumber: userOptions.userPhoneNumber,
      isDemo,
      confirmedDisclaimer,
      volunteerEngaged,
      lastVoterMessageSecsFromEpoch: Math.round(Date.now() / 1000),
      // Not necessary except for DB logging purposes. The twilioPhoneNumber reveals
      // the entry point. But to log for automated messages and Slack-to-Twilio
      // messages, this is necessary.
      entryPoint,
      numStateSelectionAttempts: 0,
      // Start time for this session, with a bit of slop to capture the first message
      sessionStartEpoch: Math.round(Date.now() / 1000) - 10,
      returningVoter: returningVoter,
    } as UserInfo;
  }

  public async replyToVoted(
    userInfo: UserInfo,
    twilioPhoneNumber: string,
    twilioCallbackURL: string,
    userMessage: string,
    inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry
  ): Promise<void> {
    // record the incoming user message
    await SlackApiUtil.sendMessage(
      userMessage,
      {
        parentMessageTs: userInfo[userInfo.activeChannelId],
        channel: userInfo.activeChannelId,
        isVoterMessage: true,
      },
      inboundDbMessageEntry,
      userInfo
    );
    const replyMessage = MessageConstants.VOTED_RESPONSE();

    await this.constituentManagementService.sendMessageToConstituent({
      message: replyMessage,
      automated: true
    });
    await SlackApiUtil.sendMessage(replyMessage, {
      parentMessageTs: userInfo[userInfo.activeChannelId],
      channel: userInfo.activeChannelId,
      isAutomatedMessage: true,
    });
  }

  public async recordVotedStatus(
    userInfo: UserInfo,
    twilioPhoneNumber: string
  ): Promise<void> {
    // Log the VOTED status
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
    await SlackApiUtil.sendMessage(
      `*Operator:* Voter status changed to *VOTED* by user text.`,
      {
        channel: userInfo.activeChannelId,
        parentMessageTs: userInfo[userInfo.activeChannelId],
      }
    );

    // Update voter status blocks
    const blocks = await SlackBlockUtil.getVoterPanel(
      userInfo,
      twilioPhoneNumber,
      undefined,
      'VOTED',
      undefined
    );
    await SlackInteractionApiUtil.replaceSlackMessageBlocks({
      slackChannelId: userInfo.activeChannelId,
      slackParentMessageTs: userInfo[userInfo.activeChannelId],
      newBlocks: blocks,
    });
  }

  public async postUserMessageHistoryToSlack(
    redisClient: PromisifiedRedisClient,
    userInfo: UserInfo,
    twilioPhoneNumber: string,
    {
      destinationSlackParentMessageTs,
      destinationSlackChannelId,
    }: {
      destinationSlackParentMessageTs: string;
      destinationSlackChannelId: string;
    }
  ): Promise<string | null> {
    logger.debug('ENTERING ServiceCoordinator.postUserMessageHistoryToSlack');

    // past sessions
    const sessionHistory = await DbApiUtil.getPastSessionThreads(
      userInfo.userId,
      twilioPhoneNumber
    );
    if (sessionHistory?.length > 0) {
      const slackChannelIds = await RedisApiUtil.getHash(
        redisClient,
        'slackPodChannelIds'
      );
      const slackChannelNames: Record<string, string> = {};
      for (const name in slackChannelIds) {
        slackChannelNames[slackChannelIds[name]] = name;
      }

      for (const thread of sessionHistory) {
        const url = await SlackApiUtil.getThreadPermalink(
          thread.channelId,
          thread.historyTs || thread.slackParentMessageTs
        );
        const lastUpdateEpoch = Date.parse(thread.lastUpdate || '') / 1000;
        const endTime = `<!date^${lastUpdateEpoch}^{time} {date_short}|${lastUpdateEpoch}>`;
        let description = `Past session in ${SlackApiUtil.linkToSlackChannel(
          thread.channelId,
          slackChannelNames[thread.channelId]
        )} ended ${endTime} - <${url}|Open>`;
        if (thread?.topics) {
          description +=
            '\nTopics: ' +
            thread.topics
              .map((k) => {
                return SessionTopics[k];
              })
              .join(', ');
        }
        await SlackApiUtil.sendMessage('', {
          parentMessageTs: destinationSlackParentMessageTs,
          channel: destinationSlackChannelId,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: description,
              },
            },
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  style: 'primary',
                  text: {
                    type: 'plain_text',
                    text: 'Show',
                    emoji: true,
                  },
                  action_id: SlackActionId.VOTER_SESSION_EXPAND,
                  value: `${userInfo.userId} ${twilioPhoneNumber} ${thread.sessionStartEpoch} ${thread.sessionEndEpoch} 0`,
                },
              ],
            },
          ],
        });
      }
    }

    // messages
    const messageHistory = await DbApiUtil.getMessageHistoryFor(
      userInfo.userId,
      twilioPhoneNumber,
      DbApiUtil.epochToPostgresTimestamp(userInfo.sessionStartEpoch || 0)
    );

    // Just in case.
    if (!messageHistory) {
      logger.debug(
        'ServiceCoordinator.postUserMessageHistoryToSlack: No message history found.'
      );
      return null;
    }

    let messageHistoryContext = "Below is the voter's message history so far.";
    if (messageHistory.length == 0) {
      messageHistoryContext =
        'This helpline session has no message history (yet).';
    }

    logger.debug(
      'ServiceCoordinator.postUserMessageHistoryToSlack: Message history found, formatting it by calling SlackMessageFormatter.'
    );
    const formattedMessageHistory = SlackMessageFormatter.formatMessageHistory(
      messageHistory,
      userInfo.userId.substring(0, 5)
    ).join('\n\n');

    const msgInfo = await SlackApiUtil.sendMessage(
      `${messageHistoryContext}\n\n${formattedMessageHistory}`,
      {
        parentMessageTs: destinationSlackParentMessageTs,
        channel: destinationSlackChannelId,
      }
    );
    if (msgInfo) {
      await DbApiUtil.setThreadHistoryTs(
        destinationSlackParentMessageTs,
        destinationSlackChannelId,
        msgInfo.data.ts
      );
      return msgInfo.data.ts;
    } else {
      return null;
    }
  }

  // This function routes a voter to a new channel WHETHER OR NOT they have
  // previously been to that channel before, creating a new thread if needed.
  public async routeVoterToSlackChannel(
    userInfo: UserInfo,
    redisClient: PromisifiedRedisClient,
    {
      twilioPhoneNumber,
      destinationSlackChannelName,
    }: {
      twilioPhoneNumber: string;
      destinationSlackChannelName: string;
    },
    adminCommandParams?: AdminCommandParams /* only for admin rerouteVoterToSlackChannel-routes or Route to Journey shortcut (not automated)*/
  ): Promise<void> {
    const skipLobby =
      (await RedisApiUtil.getKey(redisClient, 'skipLobby')) === 'true';

    logger.debug('ENTERING ServiceCoordinator.routeVoterToSlackChannel');
    const userPhoneNumber = userInfo.userPhoneNumber;

    // TODO: Consider doing this fetch within handleSlackAdminCommand, especially
    // when adding new commands that require fetching a Slack channel ID.
    let slackChannelIds = await RedisApiUtil.getHash(
      redisClient,
      'slackPodChannelIds'
    );
    let destinationSlackChannelId = slackChannelIds
      ? slackChannelIds[destinationSlackChannelName]
      : null;
    logger.debug(
      `ServiceCoordinator.routeVoterToSlackChannel: Determined destination Slack channel ID: ${destinationSlackChannelId}`
    );

    // If a destinationSlackChannelId was not fetched from Redis, refresh Redis's slackPodChannelIds cache
    // data via a call to Slack's conversation.list API and try again.
    if (!destinationSlackChannelId) {
      logger.debug(
        `ServiceCoordinator.routeVoterToSlackChannel: destinationSlackChannelId (${destinationSlackChannelId}) not found in Redis, refreshing slackPodChannelIds key using Slack conversations.list call.`
      );
      await SlackApiUtil.updateSlackChannelNamesAndIdsInRedis(redisClient);
      slackChannelIds = await RedisApiUtil.getHash(
        redisClient,
        'slackPodChannelIds'
      );
      destinationSlackChannelId = slackChannelIds[destinationSlackChannelName];
      logger.debug(
        `ServiceCoordinator.routeVoterToSlackChannel: Resulting Slack channel ID using Slack channel name (${destinationSlackChannelName}) after Slack conversations.list call: ${destinationSlackChannelId}`
      );
    }

    // Operations for successful ADMIN route of voter (admin command or Route to Journey).
    if (adminCommandParams) {
      // Error catching for admin command: destination channel not found.
      if (!destinationSlackChannelId) {
        logger.debug(
          'ServiceCoordinator.routeVoterToSlackChannel: destinationSlackChannelId not found. Did you forget to add it to slackPodChannelIds in Redis? Or if this is an admin action, did the admin type it wrong?'
        );
        // Only respond to the admin command if it's a admin control room command (not Route to Journey shortcut).
        if (
          adminCommandParams.commandChannel &&
          adminCommandParams.commandParentMessageTs &&
          adminCommandParams.commandMessageTs
        ) {
          await SlackApiUtil.sendMessage(
            `*Operator:* Slack channel ${destinationSlackChannelName} not found.`,
            {
              channel: adminCommandParams.commandChannel,
              parentMessageTs: adminCommandParams.commandParentMessageTs,
            }
          );
          await SlackApiUtil.addSlackMessageReaction(
            adminCommandParams.commandChannel,
            adminCommandParams.commandMessageTs,
            'x'
          );
          return;
        }
      }

      // TODO: This should probably be a lot later in the routing of the voter.
      logger.debug(
        'ServiceCoordinator.routeVoterToSlackChannel: Routing of voter should succeed from here on out. Letting the admin (if applicable) know.'
      );
      await SlackApiUtil.sendMessage(
        `*Operator:* Voter is being routed to ${SlackApiUtil.linkToSlackChannel(
          destinationSlackChannelId,
          destinationSlackChannelName
        )} by *${adminCommandParams.routingSlackUserName}*.`,
        {
          channel: userInfo.activeChannelId,
          parentMessageTs: userInfo[userInfo.activeChannelId],
        }
      );
      // Operations for AUTOMATED route of voter.
    } else if (!skipLobby && userInfo.activeChannelId != 'NONEXISTENT_LOBBY') {
      let msg;
      if (userInfo.activeChannelId === destinationSlackChannelId) {
        // we're routing back to the same channel (to make a new thread)
        msg = `*Operator:* Routing voter to a new thread in this channel (${SlackApiUtil.linkToSlackChannel(
          destinationSlackChannelId,
          destinationSlackChannelName
        )}).`;
      } else {
        // routing to a new channel
        msg = `*Operator:* Routing voter to ${SlackApiUtil.linkToSlackChannel(
          destinationSlackChannelId,
          destinationSlackChannelName
        )}.`;
      }

      await SlackApiUtil.sendMessage(msg, {
        channel: userInfo.activeChannelId,
        parentMessageTs: userInfo[userInfo.activeChannelId],
      });
    }

    // The old thread no longer needs attention
    const needsAttention = await DbApiUtil.getThreadNeedsAttentionFor(
      userInfo[userInfo.activeChannelId],
      userInfo.activeChannelId
    );
    const oldSlackParentMessageTs = userInfo[userInfo.activeChannelId];
    const oldChannelId = userInfo.activeChannelId;

    if (userInfo.activeChannelId !== 'NONEXISTENT_LOBBY') {
      // Close old voter panel
      await SlackBlockUtil.closeVoterPanel(
        userInfo,
        `Voter has been routed to ${SlackApiUtil.linkToSlackChannel(
          destinationSlackChannelId,
          destinationSlackChannelName
        )}.`
      );
    }

    logger.debug(
      'ServiceCoordinator.routeVoterToSlackChannel: Successfully updated old thread parent message during channel move'
    );

    // Create new thread in the channel.
    logger.debug(
      `ServiceCoordinator.routeVoterToSlackChannel: Creating a new thread in this channel (${destinationSlackChannelId}), since voter hasn't been here.`
    );

    if (adminCommandParams) {
      userInfo.panelMessage = `routed from *${adminCommandParams.previousSlackChannelName}* by *${adminCommandParams.routingSlackUserName}*`;
    }

    // Start new thread in the destination channel
    const blocks = await SlackBlockUtil.getVoterPanel(
      userInfo,
      twilioPhoneNumber
    );
    const response = await SlackApiUtil.sendMessage(blocks[0].text.text, {
      channel: destinationSlackChannelName,
      blocks: blocks,
    });

    if (!response) {
      throw new Error('Unable to send newParentMessageText as a Slack message');
    }

    // Remember the voter's thread in this channel.
    userInfo[response.data.channel] = response.data.ts;

    // Be able to identify phone number using NEW Slack channel identifying info.
    await RedisApiUtil.setHash(
      redisClient,
      `${response.data.channel}:${response.data.ts}`,
      { userPhoneNumber, twilioPhoneNumber }
    );

    // Create the thread with the origin thread's need_attention status
    await DbApiUtil.logThreadToDb({
      slackParentMessageTs: response.data.ts,
      channelId: response.data.channel,
      userId: userInfo.userId,
      userPhoneNumber: userInfo.userPhoneNumber,
      twilioPhoneNumber: twilioPhoneNumber,
      needsAttention: needsAttention,
      isDemo: userInfo.isDemo,
      sessionStartEpoch: userInfo.sessionStartEpoch || null,
    });

    logger.debug(`ServiceCoordinator.routeVoterToSlackChannel: Voter is being routed to,
    destinationSlackChannelId: ${destinationSlackChannelId},
    destinationSlackParentMessageTs: ${response.data.ts},
    destinationSlackChannelName: ${destinationSlackChannelName}`);

    logger.debug(
      "ServiceCoordinator.routeVoterToSlackChannel: Changing voter's active channel."
    );
    // Reassign the active channel so that the next voter messages go to the
    // new active channel.
    userInfo.activeChannelId = response.data.channel;
    userInfo.activeChannelName = destinationSlackChannelName;

    // Update userInfo in Redis (remember state channel thread identifying info and new activeChannel).
    logger.debug(
      `ServiceCoordinator.routeVoterToSlackChannel: Writing updated userInfo to Redis.`
    );
    await RedisApiUtil.setHash(
      redisClient,
      `${userInfo.userId}:${twilioPhoneNumber}`,
      userInfo
    );

    // Populate state channel thread with message history so far.
    await this.postUserMessageHistoryToSlack(
      redisClient,
      userInfo,
      twilioPhoneNumber,
      {
        destinationSlackParentMessageTs: response.data.ts,
        destinationSlackChannelId: response.data.channel,
      }
    );

    await DbApiUtil.setThreadInactive(oldSlackParentMessageTs, oldChannelId);

    if (
      adminCommandParams &&
      adminCommandParams.commandChannel &&
      adminCommandParams.commandMessageTs
    ) {
      await SlackApiUtil.addSlackMessageReaction(
        adminCommandParams.commandChannel,
        adminCommandParams.commandMessageTs,
        'heavy_check_mark'
      );
    }
  }



  /***********************
    TWILIO METHODS
  ************************/

  async processSmsNew(userMessage: string, userInfo: UserInfo, twilioPhoneNumber: string, inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry) {
    logger.info('Entering ServiceCoordinator.processSmsNew');
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
      // TODO: Use dbService for this instead.
      await DbApiUtil.logMessageToDb(inboundDbMessageEntry);
    } catch (error) {
      logger.info(
        `ServiceCoordinator.processSmsNew: failed to log incoming voter message to DB`
      );
      Sentry.captureException(error);
    }

    // Add key/value such that given a user phone number we can see
    // that the voter has been encountered before, even if there is not
    // yet any Slack channel/thread info for this voter.
    logger.debug(
      `ServiceCoordinator.processSmsNew: Writing new voter userInfo to Redis.`
    );
    await RedisApiUtil.setHash(
      redisClient,
      `${userInfo.userId}:${twilioPhoneNumber}`,
      userInfo
    );
  }

  async processSmsPreAutomatedEntry(userInfo: UserInfo, userMessage: string, twilioPhoneNumber: string, inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry) {
    logger.info('Entering ServiceCoordinator.processSmsPreAutomatedEntry');
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
        `failed to log incoming voter message to DB`
      );
      Sentry.captureException(error);
    }

    // Update Redis Twilio-to-Slack lookup.
    logger.debug(
      `Updating voter userInfo in Redis.`
    );
    await RedisApiUtil.setHash(
      redisClient,
      `${userInfo.userId}:${twilioPhoneNumber}`,
      userInfo
    );
  }

  async processSmsEntering(userInfo: UserInfo, twilioPhoneNumber: string, inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry) {
    logger.info('Entering ServiceCoordinator.processSmsEntering');

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
            `(${userInfo.userId}): New voter is in known state ${stateName}, selected Slack channel ${slackChannelName}`
          );
        } else {
          // That state doesn't route for some reason; go to lobby.
          logger.warning(
            `(${userInfo.userId}): New voter is in known state ${stateName}, but no channel match`
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
      } catch (error) {
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

      logger.debug(`Successfully announced new voter via new thread in ${slackChannelName},
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
          `failed to log incoming voter message to DB`
        );
        Sentry.captureException(error);
      }
      await this.postUserMessageHistoryToSlack(
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
        `Writing updated userInfo to Redis.`
      );
      await RedisApiUtil.setHash(
        redisClient,
        `${userInfo.userId}:${twilioPhoneNumber}`,
        userInfo
      );

      // Add key/value such that given Slack thread data we can get a
      // user phone number.
      logger.debug(
        `Writing updated Slack-to-Twilio redisData to Redis.`
      );
      await RedisApiUtil.setHash(
        redisClient,
        `${slackParentMessageResponse.data.channel}:${slackParentMessageResponse.data.ts}`,
        { userPhoneNumber: userInfo.userPhoneNumber, twilioPhoneNumber }
      );
      // Add key/value such that given Slack thread data we can get a
      // user phone number.
      logger.debug(
        `Writing updated Slack-to-Twilio redisData to Redis.`
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
      // TODO: Fully remove this after other parts of the code are no longer reliant on it.
      // userInfo.activeChannelId = "NONEXISTENT_LOBBY";
      // userInfo.activeChannelName = "lobby";
      inboundDbMessageEntry.slackChannel = "NONEXISTENT_LOBBY"
      inboundDbMessageEntry.slackParentMessageTs = "NONEXISTENT_LOBBY_TS";
      inboundDbMessageEntry.slackSendTimestamp = new Date();
      // The message will be relayed via the message history, so this field isn't relevant.
      inboundDbMessageEntry.successfullySent = null;
      try {
        await DbApiUtil.logMessageToDb(inboundDbMessageEntry);
      } catch (error) {
        logger.info(
          `failed to log incoming voter message to DB`
        );
        Sentry.captureException(error);
      }
    }

    // Add key/value such that given a user phone number we can get the
    // Slack channel thread associated with that user.
    logger.debug(
      `Writing updated userInfo to Redis.`
    );
    await RedisApiUtil.setHash(
      redisClient,
      `${userInfo.userId}:${twilioPhoneNumber}`,
      userInfo
    );
  }

  async processSmsHasEnteredAutomated(userInfo: UserInfo, userMessage: string, twilioPhoneNumber: string, inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry,
    twilioCallbackURL: string, userId: string, userAttachments: any[]) {
    if (KeywordParser.isVotedKeyword(userMessage)) {
      await this.recordVotedStatus(userInfo!, twilioPhoneNumber);
      await this.replyToVoted(
        userInfo!,
        twilioPhoneNumber,
        twilioCallbackURL,
        userMessage,
        inboundDbMessageEntry
      );
    } else {
      logger.info(
        `ServiceCoordinator.processSmsHasEnteredAutomated (${userId}): U.S. state for voter is not known. Automated system will attempt to determine.`
      );

      userInfo.numStateSelectionAttempts++;

      userInfo.lastVoterMessageSecsFromEpoch = Math.round(Date.now() / 1000);
      logger.debug(
        `ServiceCoordinator.processSmsHasEnteredAutomated: Updating lastVoterMessageSecsFromEpoch to ${userInfo.lastVoterMessageSecsFromEpoch}`
      );

      const skipLobby =
        (await RedisApiUtil.getKey(redisClient, 'skipLobby')) === 'true';

      const lobbyChannelId = skipLobby ? '' : userInfo.activeChannelId;
      const lobbyParentMessageTs = skipLobby ? '' : userInfo[lobbyChannelId];

      if (!skipLobby && userInfo.activeChannelId != 'NONEXISTENT_LOBBY') {
        logger.debug(
          `ServiceCoordinator.processSmsHasEnteredAutomated: Passing voter message to Slack, slackChannelName: ${lobbyChannelId}, parentMessageTs: ${lobbyParentMessageTs}.`
        );
        const blocks = SlackBlockUtil.formatMessageWithAttachmentLinks(
          userMessage,
          userAttachments
        );
        await SlackApiUtil.sendMessage(
          '',
          {
            parentMessageTs: lobbyParentMessageTs,
            blocks,
            channel: lobbyChannelId,
            isVoterMessage: true,
          },
          inboundDbMessageEntry,
          userInfo
        );
      } else {
        if (inboundDbMessageEntry) {
          logger.info(
            `SLACKAPIUTIL.sendMessage: This Slack message send will log to DB (inboundDbMessageEntry is not null).`
          );
          // Copies a few fields from userInfo to inboundDbMessageEntry.
          DbApiUtil.updateDbMessageEntryWithUserInfo(
            userInfo!,
            inboundDbMessageEntry
          );
          inboundDbMessageEntry.slackChannel = 'NONEXISTENT_LOBBY';
          inboundDbMessageEntry.slackParentMessageTs = 'NONEXISTENT_LOBBY_TS';
          inboundDbMessageEntry.slackSendTimestamp = new Date();
        }
        inboundDbMessageEntry.successfullySent = true;

        try {
          await DbApiUtil.logMessageToDb(inboundDbMessageEntry);
        } catch (error) {
          logger.info(
            `SLACKAPIUTIL.sendMessage: failed to log message send success to DB`
          );
          Sentry.captureException(error);
        }
      }

      let stateName = StateParser.determineState(userMessage);

      if (stateName == null) {
        // If we've tried to determine their U.S. state enough times, choose the National channel
        // and let the voter know a volunteer is being sought.
        if (userInfo.numStateSelectionAttempts >= 2) {
          stateName = 'National';
          // Otherwise, try to determine their U.S. state one more time.
        } else {
          logger.debug(
            `ServiceCoordinator.processSmsHasEnteredAutomated: StateParser could not determine U.S. state of voter from message ${userMessage}`
          );

          await this.constituentManagementService.sendMessageToConstituent({
            message: MessageConstants.CLARIFY_STATE(),
            automated: true
          });

          if (!skipLobby && userInfo.activeChannelId != 'NONEXISTENT_LOBBY') {
            await SlackApiUtil.sendMessage(MessageConstants.CLARIFY_STATE(), {
              parentMessageTs: lobbyParentMessageTs,
              channel: lobbyChannelId,
              isAutomatedMessage: true,
            });
          }

          logger.debug(
            `ServiceCoordinator.processSmsHasEnteredAutomated: Writing updated userInfo to Redis.`
          );
          await RedisApiUtil.setHash(
            redisClient,
            `${userId}:${twilioPhoneNumber}`,
            userInfo
          );

          return;
        }
      }

      // This is used for display, DB logging, as well as to know later that the voter's
      // U.S. state has been determined.
      userInfo.stateName = stateName;
      logger.debug(
        `ServiceCoordinator.processSmsHasEnteredAutomated: StateParser reviewed ${userMessage} and determined U.S. state: ${stateName}`
      );

      const messageToVoter =
        userInfo.stateName === 'National'
          ? MessageConstants.FINDING_VOLUNTEER()
          : MessageConstants.STATE_CONFIRMATION(stateName);
      await this.constituentManagementService.sendMessageToConstituent({
        message: messageToVoter,
        automated: true
      });
      if (!skipLobby && userInfo.activeChannelId != 'NONEXISTENT_LOBBY') {
        await SlackApiUtil.sendMessage(messageToVoter, {
          parentMessageTs: lobbyParentMessageTs,
          channel: lobbyChannelId,
          isAutomatedMessage: true,
        });
      }

      let selectedStateChannelName = await LoadBalancer.selectSlackChannel(
        redisClient,
        LoadBalancer.PULL_ENTRY_POINT,
        stateName,
        userInfo.isDemo
      );

      if (!selectedStateChannelName) {
        selectedStateChannelName = userInfo.isDemo
          ? 'demo-national-0'
          : 'national-0';
        logger.error(
          `ERROR in selecting U.S. state channel. Defaulting to ${selectedStateChannelName}.`
        );
      } else {
        logger.debug(
          `U.S. state channel successfully selected: ${selectedStateChannelName}`
        );
      }

      await this.routeVoterToSlackChannel(userInfo, redisClient, {
        twilioPhoneNumber,
        destinationSlackChannelName: selectedStateChannelName,
      });
    }
  }

  async processSmsHasEnteredConversation(userInfo: UserInfo, userMessage: string, twilioPhoneNumber: string, inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry, userPhoneNumber: string,
    userAttachments: any[], twilioCallbackURL: string, userId: string) {
    if (KeywordParser.isVotedKeyword(userMessage)
    ) {
      await this.recordVotedStatus(userInfo!, twilioPhoneNumber);
    }
    logger.info(
      `ServiceCoordinator.processSmsHasEnteredConversation (${userId}): Known U.S. state for voter (${userInfo!.stateName}) or volunteer has engaged (${userInfo!.volunteerEngaged}). Automated system no longer active.`
    );
    const userOptions = { userInfo: userInfo!, userPhoneNumber, userMessage, userAttachments };

    const activeChannelMessageParams = {
      parentMessageTs: userInfo[userInfo.activeChannelId],
      channel: userInfo.activeChannelId,
    };

    const nowSecondsEpoch = Math.round(Date.now() / 1000);
    // Remember the lastVoterMessageSecsFromEpoch, for use in calculation below.
    const lastVoterMessageSecsFromEpoch = userInfo.lastVoterMessageSecsFromEpoch;
    // Update the lastVoterMessageSecsFromEpoch, for use in DB write below.
    userInfo.lastVoterMessageSecsFromEpoch = nowSecondsEpoch;

    const blocks = SlackBlockUtil.formatMessageWithAttachmentLinks(
      userOptions.userMessage,
      userOptions.userAttachments
    );

    await SlackApiUtil.sendMessage(
      '',
      {
        ...activeChannelMessageParams,
        blocks,
        isVoterMessage: true,
      },
      inboundDbMessageEntry,
      userInfo
    );

    // Update thread needs attention status -> true
    await DbApiUtil.setThreadNeedsAttentionToDb(
      userInfo[userInfo.activeChannelId],
      userInfo.activeChannelId,
      true
    );

    logger.debug(
      `ServiceCoordinator.handleClearedVoter: Seconds since last message from voter: ${nowSecondsEpoch - lastVoterMessageSecsFromEpoch
      }`
    );

    if (
      nowSecondsEpoch - lastVoterMessageSecsFromEpoch >
      MINS_BEFORE_WELCOME_BACK_MESSAGE * 60
    ) {
      logger.debug(
        `ServiceCoordinator.handleClearedVoter: Seconds since last message from voter > MINS_BEFORE_WELCOME_BACK_MESSAGE (${nowSecondsEpoch - lastVoterMessageSecsFromEpoch
        } > : ${MINS_BEFORE_WELCOME_BACK_MESSAGE}), sending welcome back message.`
      );
      let userMessage = null as string | null;
      if (isVotedKeyword(userOptions.userMessage)) {
        userMessage = MessageConstants.VOTED_RESPONSE();
      } else {
        userMessage = MessageConstants.WELCOME_BACK();
      }

      await this.constituentManagementService.sendMessageToConstituent({
        message: userMessage,
        automated: true
      });
      await SlackApiUtil.sendMessage(userMessage, {
        ...activeChannelMessageParams,
        isAutomatedMessage: true,
      });

      if (process.env.CLIENT_ORGANIZATION === 'GADEMS') {
        // GA Dems starts a new thread if an old voters comes back rather
        // than continuing to use the existing thread. We do this by "routing"
        // the voter back to the same channel
        await this.routeVoterToSlackChannel(userInfo, redisClient, {
          twilioPhoneNumber,
          destinationSlackChannelName: userInfo.activeChannelName,
        });
      }
    }

    logger.debug(`ServiceCoordinator.handleClearedVoter: Writing updated userInfo to Redis.`);
    await RedisApiUtil.setHash(
      redisClient,
      `${userId}:${twilioPhoneNumber}`,
      userInfo
    );
  }

  async processSmsReturning(userInfo: UserInfo, userMessage: string, twilioPhoneNumber: string, inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry,
    userPhoneNumber: string, twilioCallbackURL: string, userId: string, entryPoint: EntryPoint, returningVoter: boolean, userAttachments: any[]) {
    if (KeywordParser.isVotedKeyword(userMessage)
    ) {
      await this.recordVotedStatus(userInfo!, twilioPhoneNumber);
    }
    // Treat this as a new session
    this.agentManagementService.endVoterSession(redisClient, userInfo, twilioPhoneNumber);
    // TODO: Reconcile this with the userOptions defined above in a separate switch branch.
    const userOptions = {
      userPhoneNumber,
      userMessage,
      userAttachments,
      userId,
    };
    userInfo = this.prepareUserInfoForNewVoter({
      userOptions,
      twilioPhoneNumber,
      entryPoint,
      returningVoter,
    });

    await this.handleNewVoter(
      userInfo,
      userOptions,
      redisClient,
      twilioPhoneNumber,
      inboundDbMessageEntry,
      entryPoint,
      twilioCallbackURL,
      true /* includeWelcome */
    );
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
        this.processSmsNew(userMessage, userInfo, twilioPhoneNumber, inboundDbMessageEntry);
        break;
      }
      /********************
        PRE_ENTERING_AUTOMATED
      ********************/
      case ConstituentStatus.PRE_ENTERING_AUTOMATED: {
        this.processSmsPreAutomatedEntry(userInfo, userMessage, twilioPhoneNumber, inboundDbMessageEntry);
        break;
      }
      /********************
        ENTERING
      ********************/
      case ConstituentStatus.ENTERING: {
        this.processSmsEntering(userInfo, twilioPhoneNumber, inboundDbMessageEntry);
        break;
      }
      /********************
        HAS_ENTERED_AUTOMATED
      ********************/
      case ConstituentStatus.HAS_ENTERED_AUTOMATED: {
        this.processSmsHasEnteredAutomated(userInfo, userMessage, twilioPhoneNumber, inboundDbMessageEntry, twilioCallbackURL, userId, userAttachments);
        break;
      }
      /********************
        HAS_ENTERED_CONVERSATION
      ********************/
      case ConstituentStatus.HAS_ENTERED_CONVERSATION: {
        this.processSmsHasEnteredConversation(userInfo, userMessage, twilioPhoneNumber, inboundDbMessageEntry, userPhoneNumber, userAttachments, twilioCallbackURL, userId);
        break;
      }
      /********************
        RETURNING
      ********************/
      case ConstituentStatus.RETURNING: {
        this.processSmsReturning(userInfo, userMessage, twilioPhoneNumber, inboundDbMessageEntry, userPhoneNumber, twilioCallbackURL, userId, entryPoint, returningVoter, userAttachments);
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

  /***********************
    INFRA METHODS
  ************************/

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
