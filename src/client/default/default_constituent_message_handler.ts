import * as Sentry from '@sentry/node';

import ConstituentMessageHandler from '../../constituent_message_handler';
import ConstituentCommunicator from '../../constituent_communicator';
import AgentCommunicator from '../../agent_communicator';
import config from './../../config';
import { ConstituentStatus, EntryPoint, UserInfo } from '../../types';
import * as KeywordParser from './../../keyword_parser';
import logger from './../../logger';
import * as DbApiUtil from './../../db_api_util';
import * as MessageConstants from './../../message_constants';
import * as RedisApiUtil from './../../redis_api_util';
import redisClient from '../../redis_client';
import * as LoadBalancer from './../../load_balancer';
import * as SlackBlockUtil from './../../slack_block_util';
import * as StateParser from './../../state_parser';

const MINS_BEFORE_WELCOME_BACK_MESSAGE = 60 * 24;

export default class DefaultConstituentMessageHandler extends ConstituentMessageHandler {
    constructor(constituentCommunicator: ConstituentCommunicator, agentCommunicator: AgentCommunicator) {
        super(constituentCommunicator, agentCommunicator);
    }

  // Method containing high-level logic for the general approach to be used
  // for an incoming constituent message.
  public determineConstituentStatus(): void {
    const constituentId = this.constituent.id;
    if (this.constituent.known) {
        if ('activeChannelId' in this.constituent.info!) {
          if (config.enableMultiCycleFeature && this.isConstituentReturningFromPreviousCycle()) {
            // TODO: Add helper function to make these logs briefer, e.g. by prepending the location.
            logger.info(
              `ConstituentMessageHandler.determineConstituentStatus (${constituentId}): determined that voter is returning from a previous cycle, starting with fresh userInfo`
            );
            this.constituent.info.returningVoter = true;
            this.constituent.status = ConstituentStatus.RETURNING;
          } else if (this.constituent.known && 'activeChannelId' in this.constituent.info) {
            if (this.constituent.info.stateName ||
              this.constituent.info.volunteerEngaged ||
              this.constituent.info.numStateSelectionAttempts >=
              config.numStateSelectionAttemptsLimit) {
                this.constituent.status = ConstituentStatus.HAS_ENTERED_CONVERSATION;
              } else {
                this.constituent.status = ConstituentStatus.HAS_ENTERED_AUTOMATED;
              }
          }
        } else if (this.constituent.message && KeywordParser.isHelplineKeyword(this.constituent.message)) {
          this.constituent.status = ConstituentStatus.ENTERING;
        } else {
          this.constituent.status = ConstituentStatus.PRE_ENTERING_AUTOMATED;
        }
    } else {
      logger.info(
        `ConstituentMessageHandler.determineConstituentStatus (${constituentId}): No existing userInfo for user after Redis retrieval with redisHashKey ${`${constituentId}:${this.twilioPhoneNumber}`}`);
        if (this.constituent.message && KeywordParser.isHelplineKeyword(this.constituent.message)) {
          this.constituent.status = ConstituentStatus.ENTERING;
        } else {
          this.constituent.status = ConstituentStatus.NEW;
        }
    }
  }

  public async processSmsNew(userInfo: UserInfo, inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry) {
    logger.info('Entering DefaultConstituentMessageHandler.processSmsNew');
    //T OK TO KEEP THIS MESSAGE LOGIC HERE FOR NOW
    let messageToVoter = MessageConstants.WELCOME_VOTER();
    if (KeywordParser.isVotedKeyword(this.constituent.message)) {
      messageToVoter = MessageConstants.VOTED_WELCOME_RESPONSE();

      //T Should this pull from userinfo or User somewhere else?
      //T Should there be one version of userinfo stored somewhere, and if so where?
      await DbApiUtil.logVoterStatusToDb({
        userId: userInfo.userId,
        userPhoneNumber: userInfo.userPhoneNumber,
        twilioPhoneNumber: this.twilioPhoneNumber,
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

    await this.constituentCommunicator.sendMessage({
      message: messageToVoter,
      automated: true,
      userInfo,
    });

    DbApiUtil.updateDbMessageEntryWithUserInfo(userInfo!, inboundDbMessageEntry);

    // The message isn't being relayed, so don't fill this field in Postgres.
    inboundDbMessageEntry.successfullySent = null;
    try {
      // TODO: Use dbService for this instead.
      await DbApiUtil.logMessageToDb(inboundDbMessageEntry);
    } catch (error) {
      logger.info(
        `DefaultConstituentMessageHandler.processSmsNew: failed to log incoming voter message to DB`
      );
      Sentry.captureException(error);
    }

    // Add key/value such that given a user phone number we can see
    // that the voter has been encountered before, even if there is not
    // yet any Slack channel/thread info for this voter.
    logger.debug(
      `DefaultConstituentMessageHandler.processSmsNew: Writing new voter userInfo to Redis.`
    );
    await RedisApiUtil.setHash(
      redisClient,
      `${userInfo.userId}:${this.twilioPhoneNumber}`,
      userInfo
    );
  }

  public async processSmsPreAutomatedEntry(userInfo: UserInfo, inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry) {
    logger.info('Entering DefaultConstituentMessageHandler.processSmsPreAutomatedEntry');
    let messageToVoter = MessageConstants.CLARIFY_HELPLINE_REQUEST();
    if (KeywordParser.isVotedKeyword(this.constituent.message)) {
      messageToVoter = MessageConstants.VOTED_WELCOME_RESPONSE();
      await DbApiUtil.logVoterStatusToDb({
        userId: userInfo.userId,
        userPhoneNumber: userInfo.userPhoneNumber,
        twilioPhoneNumber: this.twilioPhoneNumber,
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

    await this.constituentCommunicator.sendMessage({
      message: messageToVoter,
      automated: true,
      userInfo,
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
      `${userInfo.userId}:${this.twilioPhoneNumber}`,
      userInfo
    );
  }

  public async processSmsEntering(userInfo: UserInfo, inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry) {
    logger.info('Entering DefaultConstituentMessageHandler.processSmsEntering');

    await DbApiUtil.logInitialVoterStatusToDb(
      userInfo.userId,
      userInfo.userPhoneNumber,
      this.twilioPhoneNumber,
      userInfo.isDemo
    );

    let slackChannelName;
    if (config.skipLobby) {
      slackChannelName = null;
    } else {
      slackChannelName = userInfo.isDemo ? 'demo-lobby' : 'lobby' as string | null;
    }
    let stateName;
    // Can we infer the voter's state from their phone number?
    // TODO: Handle this in the determineConstituentStatus function in ConstituentMessageHandler.
    if (
      config.enableKnownStateFromPhoneNumber
    ) {
      stateName = super.fetchAndLoadKnownState();
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
      this.twilioPhoneNumber
    );
    let messageToConstituent;
    if (!this.constituent.known) {
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
    DbApiUtil.updateDbMessageEntryWithUserInfo(
      userInfo!,
      inboundDbMessageEntry
    );
    if (slackChannelName) {
      const topLevelThreadSlackBlocks = await SlackBlockUtil.getVoterPanel(
        userInfo,
        this.twilioPhoneNumber,
        undefined,
        status || 'UNKNOWN'
      );
      try {
        slackParentMessageResponse = await this.agentCommunicator.sendMessage(topLevelThreadSlackBlocks[0].text.text, {
          channel: slackChannelName,
          blocks: topLevelThreadSlackBlocks,
        });
      } catch (error) {
        await this.constituentCommunicator.sendMessage({
          message: `There was an unexpected error sending your message. Please wait a few minutes and try again.`,
          automated: true,
          userInfo,
        });
        throw new Error(
          `Could not send introduction slack message with voter info for voter ${userInfo.userPhoneNumber} texting ${this.twilioPhoneNumber}. Error: ${error}`
        );
      }

      // This should never be null because this.agentCommunicator.sendMessage always either returns a successful
      // response or throws an error, which would be caught above.
      // TODO: We should consolidate this with the error catch above.
      if (!slackParentMessageResponse) {
        // TODO: This can be pulled out of the if/else block since it's run whether or not the lobby is skipped (ie slackChannelName exists).
        this.constituentCommunicator.sendMessage({
          message: `There was an unexpected error sending your message. Please wait a few minutes and try again.`,
          automated: true,
          userInfo,
        });
        throw new Error(
          `Could not send introduction slack message with voter info for voter ${userInfo.userPhoneNumber} texting ${this.twilioPhoneNumber}.`
        );
      }
      this.constituentCommunicator.sendMessage({
        message: messageToConstituent,
        automated: true,
        userInfo,
      });

      logger.debug(`Successfully announced new voter via new thread in ${slackChannelName},
        response.data.channel: ${slackParentMessageResponse.data.channel},
        response.data.ts: ${slackParentMessageResponse.data.ts}`);

      await DbApiUtil.logThreadToDb({
        slackParentMessageTs: slackParentMessageResponse.data.ts,
        channelId: slackParentMessageResponse.data.channel,
        userId: userInfo.userId,
        userPhoneNumber: userInfo.userPhoneNumber,
        twilioPhoneNumber: this.twilioPhoneNumber,
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
      await super.postUserMessageHistoryToSlack(
        redisClient,
        userInfo,
        this.twilioPhoneNumber,
        {
          destinationSlackParentMessageTs: slackParentMessageResponse.data.ts,
          destinationSlackChannelId: slackParentMessageResponse.data.channel,
        }
      );
      // Add key/value such that given Slack thread data we can get a
      // user phone number.
      logger.debug(
        `Writing updated Slack-to-Twilio redisData to Redis.`
      );
      await RedisApiUtil.setHash(
        redisClient,
        `${slackParentMessageResponse.data.channel}:${slackParentMessageResponse.data.ts}`,
        { userPhoneNumber: userInfo.userPhoneNumber, twilioPhoneNumber: this.twilioPhoneNumber }
      );
    // Config requires skipping the lobby.
    } else {
      // TODO: This can be pulled out of the if/else block since it's run whether or not the lobby is skipped (ie slackChannelName exists).
      this.constituentCommunicator.sendMessage({
        message: messageToConstituent,
        automated: true,
        userInfo,
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
      `${userInfo.userId}:${this.twilioPhoneNumber}`,
      userInfo
    );
  }

  public async processSmsHasEnteredAutomated(userInfo: UserInfo, inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry) {
    if (KeywordParser.isVotedKeyword(this.constituent.message)) {
      await super.recordVotedStatus(userInfo!, this.twilioPhoneNumber);
      await super.replyToVoted(
        userInfo!,
        this.twilioPhoneNumber,
        this.constituent.message,
        inboundDbMessageEntry
      );
    } else {
      logger.info(
        `DefaultConstituentMessageHandler.processSmsHasEnteredAutomated (${this.constituent.id}): U.S. state for voter is not known. Automated system will attempt to determine.`
      );

      userInfo.numStateSelectionAttempts++;

      userInfo.lastVoterMessageSecsFromEpoch = Math.round(Date.now() / 1000);
      logger.debug(
        `DefaultConstituentMessageHandler.processSmsHasEnteredAutomated: Updating lastVoterMessageSecsFromEpoch to ${userInfo.lastVoterMessageSecsFromEpoch}`
      );

      const lobbyChannelId = config.skipLobby ? '' : userInfo.activeChannelId;
      const lobbyParentMessageTs = config.skipLobby ? '' : userInfo[lobbyChannelId];

      if (!config.skipLobby && userInfo.activeChannelId != 'NONEXISTENT_LOBBY') {
        logger.debug(
          `DefaultConstituentMessageHandler.processSmsHasEnteredAutomated: Passing voter message to Slack, slackChannelName: ${lobbyChannelId}, parentMessageTs: ${lobbyParentMessageTs}.`
        );
        const blocks = SlackBlockUtil.formatMessageWithAttachmentLinks(
            this.constituent.message,
            this.userAttachments
        );
        await this.agentCommunicator.sendMessage(
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
            `this.agentCommunicator.sendMessage: This Slack message send will log to DB (inboundDbMessageEntry is not null).`
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
            `this.agentCommunicator.sendMessage: failed to log message send success to DB`
          );
          Sentry.captureException(error);
        }
      }

      let stateName = StateParser.determineState(this.constituent.message);

      if (stateName == null) {
        // If we've tried to determine their U.S. state enough times, choose the National channel
        // and let the voter know a volunteer is being sought.
        if (userInfo.numStateSelectionAttempts >= 2) {
          stateName = 'National';
          // Otherwise, try to determine their U.S. state one more time.
        } else {
          logger.debug(
            `DefaultConstituentMessageHandler.processSmsHasEnteredAutomated: StateParser could not determine U.S. state of voter from message ${this.constituent.message}`
          );

          this.constituentCommunicator.sendMessage({
            message: MessageConstants.CLARIFY_STATE(),
            automated: true,
            userInfo,
          });

          if (!config.skipLobby && userInfo.activeChannelId != 'NONEXISTENT_LOBBY') {
            await this.agentCommunicator.sendMessage(MessageConstants.CLARIFY_STATE(), {
              parentMessageTs: lobbyParentMessageTs,
              channel: lobbyChannelId,
              isAutomatedMessage: true,
            });
          }

          logger.debug(
            `DefaultConstituentMessageHandler.processSmsHasEnteredAutomated: Writing updated userInfo to Redis.`
          );
          await RedisApiUtil.setHash(
            redisClient,
            `${this.constituent.id}:${this.twilioPhoneNumber}`,
            userInfo
          );

          return;
        }
      }

      // This is used for display, DB logging, as well as to know later that the voter's
      // U.S. state has been determined.
      userInfo.stateName = stateName;
      logger.debug(
        `DefaultConstituentMessageHandler.processSmsHasEnteredAutomated: StateParser reviewed ${this.constituent.message} and determined U.S. state: ${stateName}`
      );

      const messageToVoter =
        userInfo.stateName === 'National'
          ? MessageConstants.FINDING_VOLUNTEER()
          : MessageConstants.STATE_CONFIRMATION(stateName);
      this.constituentCommunicator.sendMessage({
        message: messageToVoter,
        automated: true,
        userInfo,
      });
      if (!config.skipLobby && userInfo.activeChannelId != 'NONEXISTENT_LOBBY') {
        await this.agentCommunicator.sendMessage(messageToVoter, {
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

      await super.routeVoterToSlackChannel(userInfo, redisClient, {
        twilioPhoneNumber: this.twilioPhoneNumber,
        destinationSlackChannelName: selectedStateChannelName,
      });
    }
  }

  public async processSmsHasEnteredConversation(userInfo: UserInfo, inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry) {
    if (KeywordParser.isVotedKeyword(this.constituent.message)
    ) {
      await super.recordVotedStatus(userInfo!, this.twilioPhoneNumber);
    }
    logger.info(
      `DefaultConstituentMessageHandler.processSmsHasEnteredConversation (${this.constituent.id}): Known U.S. state for voter (${userInfo!.stateName}) or volunteer has engaged (${userInfo!.volunteerEngaged}). Automated system no longer active.`
    );
    const userOptions = { userInfo: userInfo!, userPhoneNumber: this.constituent.phoneNumber, userMessage: this.constituent.message, userAttachments: this.userAttachments };

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

    await this.agentCommunicator.sendMessage(
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
      `DefaultConstituentMessageHandler.handleClearedVoter: Seconds since last message from voter: ${nowSecondsEpoch - lastVoterMessageSecsFromEpoch
      }`
    );

    if (
      nowSecondsEpoch - lastVoterMessageSecsFromEpoch >
      MINS_BEFORE_WELCOME_BACK_MESSAGE * 60
    ) {
      logger.debug(
        `DefaultConstituentMessageHandler.handleClearedVoter: Seconds since last message from voter > MINS_BEFORE_WELCOME_BACK_MESSAGE (${nowSecondsEpoch - lastVoterMessageSecsFromEpoch
        } > : ${MINS_BEFORE_WELCOME_BACK_MESSAGE}), sending welcome back message.`
      );
      let messageToVoter = null as string | null;
      if (KeywordParser.isVotedKeyword(userOptions.userMessage)) {
        messageToVoter = MessageConstants.VOTED_RESPONSE();
      } else {
        messageToVoter = MessageConstants.WELCOME_BACK();
      }

      this.constituentCommunicator.sendMessage({
        message: messageToVoter,
        automated: true,
        userInfo,
      });
      await this.agentCommunicator.sendMessage(messageToVoter, {
        ...activeChannelMessageParams,
        isAutomatedMessage: true,
      });

      if (process.env.CLIENT_ORGANIZATION === 'GADEMS') {
        // GA Dems starts a new thread if an old voters comes back rather
        // than continuing to use the existing thread. We do this by "routing"
        // the voter back to the same channel
        await super.routeVoterToSlackChannel(userInfo, redisClient, {
          twilioPhoneNumber: this.twilioPhoneNumber,
          destinationSlackChannelName: userInfo.activeChannelName,
        });
      }
    }

    logger.debug(`DefaultConstituentMessageHandler.handleClearedVoter: Writing updated userInfo to Redis.`);
    await RedisApiUtil.setHash(
      redisClient,
      `${this.constituent.id}:${this.twilioPhoneNumber}`,
      userInfo
    );
  }

  public async processSmsReturning(userInfo: UserInfo, inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry,
    entryPoint: EntryPoint, returningVoter: boolean) {
    if (KeywordParser.isVotedKeyword(this.constituent.message)
    ) {
      await super.recordVotedStatus(userInfo!, this.twilioPhoneNumber);
    }
    // Treat this as a new session
    super.endConstituentSession(redisClient, userInfo, this.twilioPhoneNumber);
    // TODO: Reconcile this with the userOptions defined above in a separate switch branch.
    const userOptions = {
      userPhoneNumber: this.constituent.phoneNumber,
      userMessage: this.constituent.message,
      userAttachments: this.userAttachments,
      userId: this.constituent.id,
    };
    userInfo = super.prepareUserInfoForNewVoter({
      userOptions,
      twilioPhoneNumber: this.twilioPhoneNumber,
      entryPoint,
      returningVoter,
    });

    await super.handleNewVoter(
      userInfo,
      userOptions,
      redisClient,
      this.twilioPhoneNumber,
      inboundDbMessageEntry,
      entryPoint,
      true /* includeWelcome */
    );
  }
}