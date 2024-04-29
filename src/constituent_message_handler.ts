import * as Sentry from '@sentry/node';
import Hashes from 'jshashes';

import { ConstituentStatus, UserInfo, EntryPoint, SessionTopics, Request } from './types';
import * as DbApiUtil from './db_api_util';
import redisClient, { PromisifiedRedisClient } from './redis_client';
import * as KeywordParser from './keyword_parser';
import * as SlackInteractionApiUtil from './slack_interaction_api_util';
import * as RedisApiUtil from './redis_api_util';
import logger from './logger';
import Constituent from './constituent';
import * as MessageConstants from './message_constants';
import * as Router from './router';
import * as LoadBalancer from './load_balancer';
import * as StateParser from './state_parser';
import * as SlackBlockUtil from './slack_block_util';
import ConstituentCommunicator from './constituent_communicator';
import AgentCommunicator from './agent_communicator';
import * as SlackApiUtil from './slack_api_util';
import { SlackActionId } from './slack_interaction_ids';
import * as SlackMessageFormatter from './slack_message_formatter';
import * as TwilioUtil from './twilio_util';
import config from './config';

type AdminCommandParams = {
  commandParentMessageTs: string | null;
  commandMessageTs: string | null; // if command is in a thread, this is the in-thread message
  commandChannel: string | null;
  routingSlackUserName: string;
  previousSlackChannelName: string;
};

type UserOptions = {
  userMessage: string;
  userAttachments: string[];
  userPhoneNumber: string;
};

export default abstract class ConstituentMessageHandler {
  protected constituent: Constituent;
  protected twilioPhoneNumber: string;

  private userAttachments: string[];
  private inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry | undefined;
  private entryPoint: EntryPoint;

  protected constituentCommunicator: ConstituentCommunicator;
  protected agentCommunicator: AgentCommunicator;

  constructor(constituentCommunicator: ConstituentCommunicator, agentCommunicator: AgentCommunicator) {
    this.constituent = {
      info: undefined,
      status: ConstituentStatus.UNKNOWN,
      id: '',
      phoneNumber: '',
      onOptOutList: false,
      message: '',
      known: undefined,
    };
    this.userAttachments = [];
    this.twilioPhoneNumber = '';
    this.inboundDbMessageEntry = undefined;
    this.entryPoint = 'UNKNOWN';

    this.constituentCommunicator = constituentCommunicator;
    this.agentCommunicator = agentCommunicator;
  }

  public setConstituentPhoneNumber(phoneNumber: string) {
    this.constituent.phoneNumber = phoneNumber;
  }

  public setTwilioPhoneNumber(twilioPhoneNumber: string): void {
    this.twilioPhoneNumber = twilioPhoneNumber;
  }

  public setInboundDbMessageEntry(inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry): void {
    this.inboundDbMessageEntry = inboundDbMessageEntry;
  }

  public getConstituentStatus(): ConstituentStatus {
    return this.constituent.status;
  }

  public async endConstituentSession(  redisClient: PromisifiedRedisClient,
    userInfo: UserInfo,
    twilioPhoneNumber: string
  ): Promise<void> {
    // end old session thread(s)
    await DbApiUtil.setSessionEnd(userInfo.userId, twilioPhoneNumber);
  
    // clear any assigned volunteer
    await DbApiUtil.logVolunteerVoterClaimToDb({
      userId: userInfo.userId,
      userPhoneNumber: userInfo.userPhoneNumber,
      twilioPhoneNumber,
      isDemo: LoadBalancer.phoneNumbersAreDemo(
        twilioPhoneNumber,
        userInfo.userPhoneNumber
      ),
      volunteerSlackUserName: null,
      volunteerSlackUserId: null,
      originatingSlackUserName: null,
      originatingSlackUserId: null,
      slackChannelName: null,
      slackChannelId: null,
      slackParentMessageTs: null,
      actionTs: null,
    });
  
    // delete userInfo
    const redisHashKey = `${userInfo.userId}:${twilioPhoneNumber}`;
    await RedisApiUtil.deleteKeys(redisClient, [redisHashKey]);
  
    // update old session thread's panel async; do not await
    void SlackBlockUtil.closeVoterPanel(
      userInfo,
      'This voter helpline session is closed'
    );
  }

  protected async recordVotedStatus(
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
    await this.agentCommunicator.sendMessage(
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

  protected async postUserMessageHistoryToSlack(
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
    logger.debug('ENTERING Coordinator.postUserMessageHistoryToSlack');

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
        await this.agentCommunicator.sendMessage('', {
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
        'Coordinator.postUserMessageHistoryToSlack: No message history found.'
      );
      return null;
    }

    let messageHistoryContext = "Below is the voter's message history so far.";
    if (messageHistory.length == 0) {
      messageHistoryContext =
        'This helpline session has no message history (yet).';
    }

    logger.debug(
      'Coordinator.postUserMessageHistoryToSlack: Message history found, formatting it by calling SlackMessageFormatter.'
    );
    const formattedMessageHistory = SlackMessageFormatter.formatMessageHistory(
      messageHistory,
      userInfo.userId.substring(0, 5)
    ).join('\n\n');

    const msgInfo = await this.agentCommunicator.sendMessage(
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

  protected async replyToVoted(
    userInfo: UserInfo,
    twilioPhoneNumber: string,
    userMessage: string,
    inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry
  ): Promise<void> {
    // record the incoming user message
    await this.agentCommunicator.sendMessage(
      userMessage,
      {
        parentMessageTs: userInfo[userInfo.activeChannelId],
        channel: userInfo.activeChannelId,
        isVoterMessage: true,
      },
      inboundDbMessageEntry,
      userInfo);
    const replyMessage = MessageConstants.VOTED_RESPONSE();

    await this.constituentCommunicator.sendMessage({
      message: replyMessage,
      automated: true,
      userInfo,
    });
    await this.agentCommunicator.sendMessage(replyMessage, {
      parentMessageTs: userInfo[userInfo.activeChannelId],
      channel: userInfo.activeChannelId,
      isAutomatedMessage: true,
    });
  }

  // This function routes a voter to a new channel WHETHER OR NOT they have
  // previously been to that channel before, creating a new thread if needed.
  protected async routeVoterToSlackChannel(
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

    logger.debug('ENTERING Coordinator.routeVoterToSlackChannel');
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
      `Coordinator.routeVoterToSlackChannel: Determined destination Slack channel ID: ${destinationSlackChannelId}`
    );

    // If a destinationSlackChannelId was not fetched from Redis, refresh Redis's slackPodChannelIds cache
    // data via a call to Slack's conversation.list API and try again.
    if (!destinationSlackChannelId) {
      logger.debug(
        `Coordinator.routeVoterToSlackChannel: destinationSlackChannelId (${destinationSlackChannelId}) not found in Redis, refreshing slackPodChannelIds key using Slack conversations.list call.`
      );
      await SlackApiUtil.updateSlackChannelNamesAndIdsInRedis(redisClient);
      slackChannelIds = await RedisApiUtil.getHash(
        redisClient,
        'slackPodChannelIds'
      );
      destinationSlackChannelId = slackChannelIds[destinationSlackChannelName];
      logger.debug(
        `Coordinator.routeVoterToSlackChannel: Resulting Slack channel ID using Slack channel name (${destinationSlackChannelName}) after Slack conversations.list call: ${destinationSlackChannelId}`
      );
    }

    // Operations for successful ADMIN route of voter (admin command or Route to Journey).
    if (adminCommandParams) {
      // Error catching for admin command: destination channel not found.
      if (!destinationSlackChannelId) {
        logger.debug(
          'Coordinator.routeVoterToSlackChannel: destinationSlackChannelId not found. Did you forget to add it to slackPodChannelIds in Redis? Or if this is an admin action, did the admin type it wrong?'
        );
        // Only respond to the admin command if it's a admin control room command (not Route to Journey shortcut).
        if (
          adminCommandParams.commandChannel &&
          adminCommandParams.commandParentMessageTs &&
          adminCommandParams.commandMessageTs
        ) {
          await this.agentCommunicator.sendMessage(
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
        'Coordinator.routeVoterToSlackChannel: Routing of voter should succeed from here on out. Letting the admin (if applicable) know.'
      );
      await this.agentCommunicator.sendMessage(
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

      await this.agentCommunicator.sendMessage(msg, {
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
      'Coordinator.routeVoterToSlackChannel: Successfully updated old thread parent message during channel move'
    );

    // Create new thread in the channel.
    logger.debug(
      `Coordinator.routeVoterToSlackChannel: Creating a new thread in this channel (${destinationSlackChannelId}), since voter hasn't been here.`
    );

    if (adminCommandParams) {
      userInfo.panelMessage = `routed from *${adminCommandParams.previousSlackChannelName}* by *${adminCommandParams.routingSlackUserName}*`;
    }

    // Start new thread in the destination channel
    const blocks = await SlackBlockUtil.getVoterPanel(
      userInfo,
      twilioPhoneNumber
    );
    const response = await this.agentCommunicator.sendMessage(blocks[0].text.text, {
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

    logger.debug(`Coordinator.routeVoterToSlackChannel: Voter is being routed to,
    destinationSlackChannelId: ${destinationSlackChannelId},
    destinationSlackParentMessageTs: ${response.data.ts},
    destinationSlackChannelName: ${destinationSlackChannelName}`);

    logger.debug(
      "Coordinator.routeVoterToSlackChannel: Changing voter's active channel."
    );
    // Reassign the active channel so that the next voter messages go to the
    // new active channel.
    userInfo.activeChannelId = response.data.channel;
    userInfo.activeChannelName = destinationSlackChannelName;

    // Update userInfo in Redis (remember state channel thread identifying info and new activeChannel).
    logger.debug(
      `Coordinator.routeVoterToSlackChannel: Writing updated userInfo to Redis.`
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

  // prepareUserInfoForNewVoter is used by functions that handle
  // phone numbers not previously seen.
  protected prepareUserInfoForNewVoter({
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
        `Coordinator.prepareUserInfoForNewVoter (${userOptions.userId}): Evaluating isDemo based on userPhoneNumber/twilioPhoneNumber: ${isDemo}`
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

  protected async handleNewVoter(
    userInfo: UserInfo,
    userOptions: UserOptions & { userId: string },
    redisClient: PromisifiedRedisClient,
    twilioPhoneNumber: string,
    inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry,
    entryPoint: EntryPoint,
    includeWelcome?: boolean
  ): Promise<void> {
    logger.debug('ENTERING Coordinator.handleNewVoter');
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
            `Coordinator.handleNewVoter (${userInfo.userId}): unable to parse known state '${knownState}`
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
          `Coordinator.handleNewVoter (${userInfo.userId}): New voter is in known state ${userInfo.stateName}, selected Slack channel ${slackChannelName}`
        );
      } else {
        // That state doesn't route for some reason; go to national
        slackChannelName = userInfo.isDemo ? 'demo-national' : 'national';
        logger.info(
          `Coordinator.handleNewVoter (${userInfo.userId}): New voter is in known state ${userInfo.stateName}, but no channel match`
        );
      }
    }

    if (!slackChannelName) {
      slackChannelName = userInfo.isDemo ? 'demo-lobby' : 'lobby';
      if (entryPoint === LoadBalancer.PULL_ENTRY_POINT) {
        logger.debug(
          `Coordinator.handleNewVoter (${userInfo.userId}): New voter will enter Slack channel: ${slackChannelName}`
        );
      } else if (entryPoint === LoadBalancer.PUSH_ENTRY_POINT) {
        userInfo.stateName =
          LoadBalancer.getPushPhoneNumberState(twilioPhoneNumber);
        logger.debug(
          `Coordinator.handleNewVoter (${userInfo.userId}): Determined that twilioPhoneNumber ${twilioPhoneNumber} corresponds to U.S. state ${userInfo.stateName} based on hard coding in LoadBalancer.`
        );
        const selectedChannelName = await LoadBalancer.selectSlackChannel(
          redisClient,
          LoadBalancer.PUSH_ENTRY_POINT,
          userInfo.stateName
        );

        logger.debug(
          `Coordinator.handleNewVoter (${userInfo.userId}): LoadBalancer returned Slack channel ${selectedChannelName} for new PUSH voter.`
        );
        if (selectedChannelName) {
          slackChannelName = selectedChannelName;
        } else {
          // If LoadBalancer didn't find a Slack channel, then select #national or #demo-national as fallback.
          slackChannelName = userInfo.isDemo ? 'demo-national' : 'national';
          logger.error(
            `Coordinator.handleNewVoter (${userInfo.userId}): ERROR LoadBalancer did not find a Slack channel for new PUSH voter. Using ${slackChannelName} as fallback.`
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
      includeWelcome
    );
  }

  private async introduceNewVoterToSlackChannel(
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
    // This is only used by VOTE_AMERICA
    includeWelcome?: boolean,
    noWelcome?: boolean
  ): Promise<string> {
    logger.debug('ENTERING Coordinator.introduceNewVoterToSlackChannel');
    logger.debug(
      `Coordinator.introduceNewVoterToSlackChannel: Updating lastVoterMessageSecsFromEpoch to ${userInfo.lastVoterMessageSecsFromEpoch}`
    );

    logger.debug(
      `Coordinator.introduceNewVoterToSlackChannel: Announcing new voter via new thread in ${slackChannelName}.`
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
      response = await this.agentCommunicator.sendMessage(slackBlocks[0].text.text, {
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
          `Coordinator.introduceNewVoterToSlackChannel: Entry point is PULL, so sending automated welcome to voter.`
        );
        // Welcome the voter
        await this.constituentCommunicator.sendMessage({
          message: messageToVoter,
          automated: true,
          userInfo,
        });
      }
    } else {
      await this.constituentCommunicator.sendMessage({
        message: `There was an unexpected error sending your message. Please wait a few minutes and try again.`,
        automated: true,
        userInfo,
      });
      throw new Error(
        `Could not send introduction slack message with voter info for voter ${userInfo.userPhoneNumber} texting ${twilioPhoneNumber}`
      );
    }

    logger.debug(`Coordinator.introduceNewVoterToSlackChannel: Successfully announced new voter via new thread in ${slackChannelName},
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
        `Coordinator.introduceNewVoterToSlackChannel: Retrieving and passing message history to Slack, slackChannelName: ${slackChannelName}, parentMessageTs: ${response.data.channel}.`
      );

      if (!inboundDbMessageEntry) {
        logger.debug(
          `Coordinator.introduceNewVoterToSlackChannel: reopen empty session thread, slackChannelName: ${slackChannelName}, parentMessageTs: ${response.data.channel}.`
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
            `Coordinator.introduceNewVoterToSlackChannel: failed to log incoming voter message to DB`
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
        `Coordinator.introduceNewVoterToSlackChannel: Passing voter message to Slack, slackChannelName: ${slackChannelName}, parentMessageTs: ${response.data.ts}.`
      );
      if (inboundDbMessageEntry) {
        const blocks = SlackBlockUtil.formatMessageWithAttachmentLinks(
          userMessage,
          userAttachments
        );
        await this.agentCommunicator.sendMessage(
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
        `Coordinator.introduceNewVoterToSlackChannel: Passing automated welcome message to Slack, slackChannelName: ${slackChannelName}, parentMessageTs: ${response.data.channel}.`
      );
      await this.agentCommunicator.sendMessage(messageToVoter, {
        parentMessageTs: response.data.ts,
        channel: response.data.channel,
        isAutomatedMessage: true,
      });
    }

    // Add key/value such that given a user phone number we can get the
    // Slack channel thread associated with that user.
    logger.debug(
      `Coordinator.introduceNewVoterToSlackChannel: Writing updated userInfo to Redis.`
    );
    await RedisApiUtil.setHash(
      redisClient,
      `${userInfo.userId}:${twilioPhoneNumber}`,
      userInfo
    );

    // Add key/value such that given Slack thread data we can get a
    // user phone number.
    logger.debug(
      `Coordinator.introduceNewVoterToSlackChannel: Writing updated Slack-to-Twilio redisData to Redis.`
    );
    await RedisApiUtil.setHash(
      redisClient,
      `${response.data.channel}:${response.data.ts}`,
      { userPhoneNumber: userInfo.userPhoneNumber, twilioPhoneNumber }
    );
    return response.data.ts;
  }

  // Whether the phone number was blocked by the client/volunteers.
  private async isPhoneNumberBlocked(userPhoneNumber: string): Promise<boolean> {
    const redisBlockedUserPhoneNumberValue = await RedisApiUtil.getHashField(
      redisClient,
      'twilioBlockedUserPhoneNumbers',
      userPhoneNumber
    );
    
    return redisBlockedUserPhoneNumberValue == '1';
  }

  protected async fetchAndLoadKnownState(): Promise<string | null> {
    const knownState = await DbApiUtil.getKnownPhoneState(
      this.constituent.phoneNumber
    );
    if (knownState) {
      // The knownState value from the db is probably a state abbreviation, so we need to resolve it
      const stateName = StateParser.determineState(knownState);
      if (stateName && this.constituent.info) {
        // Success: we know the state
        this.constituent.info.stateName = stateName;
        this.constituent.info.panelmessage = 'known phone number';

        // TODO: Move this logic to another function that is responsible for
        // selecting a Slack channel under any conditions.
        let slackChannelName = await LoadBalancer.selectSlackChannel(
          redisClient,
          LoadBalancer.PULL_ENTRY_POINT,
          this.constituent.info.stateName,
          this.constituent.info.isDemo
        );
        if (slackChannelName) {
          return slackChannelName;
        }
      } else {
        logger.warning(
          `ConstituentMessageHandler.fetchAndLoadKnownState (${this.constituent.id}): unable to parse known state '${knownState}`
        );
        return null;
      }
    }

    return null;
  }

  private getOnOptOutList(): boolean {
    return this.constituent.onOptOutList;
  }

  private async fetchAndLoadConstituentInfo(
    twilioPhoneNumber: string
  ): Promise<UserInfo | null> {
    const redisHashKey = `${this.constituent.id}:${twilioPhoneNumber}`;

    logger.info(
      `ConstituentMessageHandler.fetchAndLoadConstituentInfo (${this.constituent.id}): Retrieving userInfo using redisHashKey: ${redisHashKey}`
    );

    // If not using Redis, replace this with a different database call.
    this.constituent.info = (await RedisApiUtil.getHash(
      redisClient,
      redisHashKey
    )) as UserInfo | null;

    logger.info(
      `ConstituentMessageHandler.determineConstituentStatus (${this.constituent.id}): Successfully received Redis response with userInfo: ${JSON.stringify(
        this.constituent.info
      )}`);

    this.constituent.known = this.constituent.info ? true : false;

    return this.constituent.info;
  }

  public loadInfoForNewConstituent({
    userPhoneNumber,
    constituentId,
    twilioPhoneNumber,
    entryPoint,
  }: {
    userPhoneNumber: string;
    constituentId: string;
    twilioPhoneNumber: string;
    entryPoint: EntryPoint;
  }): UserInfo {
    let isDemo, confirmedDisclaimer, volunteerEngaged;
    if (entryPoint === LoadBalancer.PULL_ENTRY_POINT) {
      isDemo = LoadBalancer.phoneNumbersAreDemo(
        twilioPhoneNumber,
        userPhoneNumber
      );
      logger.debug(
        `ConstituentMessageHandler.loadInfoForNewConstituent (${constituentId}): Evaluating isDemo based on userPhoneNumber/twilioPhoneNumber: ${isDemo}`
      );
      confirmedDisclaimer = false;
      volunteerEngaged = false;
    }

    const userInfo = {
      userId: constituentId,
      twilioPhoneNumber: twilioPhoneNumber,
      // Necessary for admin controls, so userPhoneNumber can be found even though
      // admins specify only userId.
      userPhoneNumber: userPhoneNumber,
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
    } as UserInfo;

    this.constituent.info = userInfo;

    return userInfo;
  }

  public async fetchAndLoadOptOutStatus(): Promise<void> {
    // TODO: Rename slackBlockedUserPhoneNumbers to something like 'optedOutPhoneNumbers'
    this.constituent.onOptOutList = await RedisApiUtil.getHashField(
      redisClient,
      'slackBlockedUserPhoneNumbers',
      this.constituent.phoneNumber,
    );
  }

  // Method defining the logic for determining if a user is a returning constituent.
  // Clients should define their own logic here, if using this feature.
  protected isConstituentReturningFromPreviousCycle(): boolean {
    // This is a reference, necessary to avoid typescript errors.
    let constituentInfo = this.constituent.info;
    if (!constituentInfo) {
      return false;
    }

    if (!constituentInfo.sessionStartEpoch) {
      // legacy session from before 2020-11-03 election
      return true;
    }
  
    if (
      process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA' &&
      constituentInfo.sessionStartEpoch < 1611775722 // Jan 27, 2021 -- VA moved all voters back to national-0
    ) {
      return true;
    }
  
    // add other "stale" logic here (e.g., session is idle for >2 months)
    // ...
  
    return false;
  }

  // Method to be called when a user is returning from a previous cycle.
  public handleReturningConstituent() {
    this.constituent.info = null;
  }

  public async handleHelplineFromOptedOutConstituent() {
    if (!this.constituent.message || !this.inboundDbMessageEntry) {
      logger.error(
        `Unexpected error: ConstituentMessageHandler.handleHelplineFromOptedOutConstituent: this.constituent.message and/or this.inboundDbMessageEntry are undefined.`
      );
      return;
    }

    // If the voter has previously opted out and then texts HELPLINE, instruct
    // them to JOIN.
    const outboundTextsBlocked = await RedisApiUtil.getHashField(
      redisClient,
      'slackBlockedUserPhoneNumbers',
      this.constituent.phoneNumber
    );
    if (outboundTextsBlocked) {
      if (!this.constituent.info) {
        // Voters that have opted out should always have a residual userInfo.  However,
        // provide this (somewhat kludgey) fallback so that they still get the message just
        // in case they don't.
        logger.info(
          `ConstituentMessageHandler.handleHelplineFromOptedOutConstituent: Received HELPLINE on refused phone number ${this.constituent.phoneNumber}; creating missing UserInfo`
        );
        const userOptions = {
          userPhoneNumber: this.constituent.phoneNumber,
          userMessage: this.constituent.message,
          userAttachments: this.userAttachments,
          userId: this.constituent.id,
        };
        this.constituent.info = Router.prepareUserInfoForNewVoter({
          userOptions,
          twilioPhoneNumber: this.twilioPhoneNumber,
          entryPoint: this.entryPoint,
          // TODO: Confirm that this is the right value. This was carried over from refactor. Ideally, deprecate this field.
          returningVoter: false,
        });
      }
      logger.info(
        `ConstituentMessageHandler.handleHelplineFromOptedOutConstituent: Received HELPLINE on refused phone number ${this.constituent.phoneNumber}; instructing them to re-JOIN`
      );

      if (!this.constituent.info || !this.constituent.message) {
        logger.error(
          `Unexpected error: ConstituentMessageHandler.handleHelplineFromOptedOutConstituent: this.constituent.info and/or this.constituent.message are undefined.`
        );
        return;
      }
      // Log incoming message
      await this.agentCommunicator.sendMessage(
        this.constituent.message,
        {
          parentMessageTs: this.constituent.info[this.constituent.info.activeChannelId],
          channel: this.constituent.info.activeChannelId,
          isVoterMessage: true,
        },
        this.inboundDbMessageEntry,
        this.constituent.info
      );
      // Reply
      const replyMessage = MessageConstants.HELPLINE_AFTER_STOP_RESPONSE();
      await this.constituentCommunicator.sendMessage({
        message: replyMessage,
        automated: true,
        userInfo: this.constituent.info,
      });
      await this.agentCommunicator.sendMessage(replyMessage, {
        parentMessageTs: this.constituent.info[this.constituent.info.activeChannelId],
        channel: this.constituent.info.activeChannelId,
        isAutomatedMessage: true,
      });
      return;
    }
  }

  // Method to handle opted out constituent logic, whether they have opted
  // out in the past or are opting out now, or are now opting back in.
  private async handleOptOutLogic(twilioPhoneNumber: string, inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry): Promise<boolean> {
    if (!this.constituent.message) {
      // Add an error message here.
      return false;
    }
    const constituentMessageIsOptOut = KeywordParser.isStopKeyword(this.constituent.message);
    if (!constituentMessageIsOptOut && !this.constituent.onOptOutList) {
        return true;
    }

    // We need to check if they're already on the list first, to avoid trying
    // to collapse an already-collapsed thread, etc.
    if (this.constituent.onOptOutList) {
      // Constituent is now wanting to rejoin.
      if (KeywordParser.isJoinKeyword(this.constituent.message)) {
        logger.info(
          `ConstituentMessageHandler.handleOptOutLogic: Received JOIN from refused phone number: ${this.constituent.phoneNumber}, unblocking.`
        );
        await RedisApiUtil.deleteHashField(
          redisClient,
          'slackBlockedUserPhoneNumbers',
          this.constituent.phoneNumber
        );
        if (this.constituent.status in [ConstituentStatus.HAS_ENTERED_AUTOMATED, ConstituentStatus.HAS_ENTERED_CONVERSATION]) {
          // TODO: Need logic here to re-open the Slack thread with the voter, if one exists.
        }
        if (this.constituent.info) this.constituent.info.returningVoter = true;
        // We return true to allow the user to continue as normal, since they opted back in.
        return true;
      } else if (this.constituent.status == ConstituentStatus.ENTERING) {
        this.handleHelplineFromOptedOutConstituent();
      }
    } else if (constituentMessageIsOptOut) {
      logger.info(
        `ConstituentMessageHandler.handleOptOutLogic: Received STOP text from phone number: ${this.constituent.phoneNumber}.`
      );
      // Check is necessary in case a previously seen voter doesn't have a Slack thread
      // and their 2nd+ message is STOP, in which case there's nothing to collapse.
      if (this.constituent.info && 'activeChannelId' in this.constituent.info) {
        // This function also handles adding the phone number to blocklists.
        await SlackInteractionApiUtil.handleAutomatedCollapseOfVoterStatusPanel(
          {
            userInfo: this.constituent.info,
            redisClient,
            newVoterStatus: 'REFUSED',
            userPhoneNumber: this.constituent.phoneNumber,
            twilioPhoneNumber,
          }
        );
      }

      logger.info(
        `ConstituentMessageHandler.handleOptOutLogic: Received STOP text from phone number: ${this.constituent.phoneNumber}.`
      );
      // Block volunteers or automated system from sending messages to this number in the future,
      // even though there is no thread from which volunteers could do so.
      await RedisApiUtil.setHash(
        redisClient,
        'slackBlockedUserPhoneNumbers',
        {
          [this.constituent.phoneNumber]: '1',
        }
      );
      // If the voter's first messsage to us is STOP, ignore any and all subsequent messages.
      await RedisApiUtil.setHash(
        redisClient,
        'twilioBlockedUserPhoneNumbers',
        {
          [this.constituent.phoneNumber]: '1',
        }
      );

      if (this.constituent.info) {
        // Update thread needs attention status -> false
        await DbApiUtil.setThreadNeedsAttentionToDb(
          this.constituent.info[this.constituent.info.activeChannelId],
          this.constituent.info.activeChannelId,
          false
        );
      }
    }

    DbApiUtil.updateDbMessageEntryWithUserInfo(
      this.constituent.info!,
      inboundDbMessageEntry
    );

    if (this.constituent.info && 'activeChannelId' in this.constituent.info) {
      // This includes a DB write of the message.
      await this.agentCommunicator.sendMessage(
        this.constituent.message,
        {
          parentMessageTs: this.constituent.info[this.constituent.info.activeChannelId],
          channel: this.constituent.info.activeChannelId,
          isVoterMessage: true,
        },
        inboundDbMessageEntry,
        this.constituent.info
      );
    } else {
      // The message isn't being relayed, so don't fill this field in Postgres.
      inboundDbMessageEntry.successfullySent = null;
      try {
        await DbApiUtil.logMessageToDb(inboundDbMessageEntry);
      } catch (error) {
        logger.info(
          `ConstituentMessageHandler.handleOptOutLogic: failed to log incoming voter message to DB`
        );
        Sentry.captureException(error);
      }
    }

    return false;
  }

  // Previous logic.
  private async handleKnownVoterBlockLogic(
    userInfo: UserInfo,
    userMessage: string,
    userPhoneNumber: string,
    twilioPhoneNumber: string,
    inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry
  ): Promise<boolean> {
    logger.debug('ENTERING ConstituentMessageHandler.handleKnownVoterBlockLogic');
    // Outbound texts should be blocked if either:
    // 1. this current message is STOP, or
    // 2. a prior interaction set outbound texts to be blocked for this user.
    let outboundTextsBlocked = await RedisApiUtil.getHashField(
      redisClient,
      'slackBlockedUserPhoneNumbers',
      userPhoneNumber
    );

    if (KeywordParser.isStopKeyword(userMessage)) {
      logger.info(
        `ConstituentMessageHandler.handleKnownVoterBlockLogic: Received STOP text from phone number: ${userPhoneNumber}.`
      );
      // Check is necessary in case a previously seen voter doesn't have a Slack thread
      // and their 2nd+ message is STOP, in which case there's nothing to collapse.
      if ('activeChannelId' in userInfo) {
        // This function also handles adding the phone number to blocklists.
        await SlackInteractionApiUtil.handleAutomatedCollapseOfVoterStatusPanel(
          {
            userInfo,
            redisClient,
            newVoterStatus: 'REFUSED',
            userPhoneNumber,
            twilioPhoneNumber,
          }
        );
      } else {
        await RedisApiUtil.setHash(
          redisClient,
          'slackBlockedUserPhoneNumbers',
          {
            [userPhoneNumber]: '1',
          }
        );
      }
      outboundTextsBlocked = true;

      // Update thread needs attention status -> false
      await DbApiUtil.setThreadNeedsAttentionToDb(
        userInfo[userInfo.activeChannelId],
        userInfo.activeChannelId,
        false
      );
    }

    // If outbound texts are prohibited to this user, we return --
    // but first, we relay the message to Slack if a thread exists for
    // this voter and we write to the DB.
    if (outboundTextsBlocked) {
      DbApiUtil.updateDbMessageEntryWithUserInfo(
        userInfo!,
        inboundDbMessageEntry
      );

      if ('activeChannelId' in userInfo) {
        // This includes a DB write of the message.
        await this.agentCommunicator.sendMessage(
          userMessage,
          {
            parentMessageTs: userInfo[userInfo.activeChannelId],
            channel: userInfo.activeChannelId,
            isVoterMessage: true,
          },
          inboundDbMessageEntry,
          userInfo
        );
      } else {
        // The message isn't being relayed, so don't fill this field in Postgres.
        inboundDbMessageEntry.successfullySent = null;
        try {
          await DbApiUtil.logMessageToDb(inboundDbMessageEntry);
        } catch (error) {
          logger.info(
            `ConstituentMessageHandler.handleKnownVoterBlockLogic: failed to log incoming voter message to DB`
          );
          Sentry.captureException(error);
        }
      }
    }
    return outboundTextsBlocked;
  }

  // Method containing high-level logic for the general approach to be used
  // for an incoming constituent message.
  protected abstract determineConstituentStatus(): void;

  protected abstract processSmsNew(userInfo: UserInfo, twilioPhoneNumber: string, inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry): Promise<void>;

  protected abstract processSmsPreAutomatedEntry(userInfo: UserInfo, twilioPhoneNumber: string, inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry): Promise<void>;

  protected abstract processSmsEntering(userInfo: UserInfo, twilioPhoneNumber: string, inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry): Promise<void>;

  protected abstract processSmsHasEnteredAutomated(userInfo: UserInfo, twilioPhoneNumber: string, inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry,
    userAttachments: any[]): Promise<void>;

  protected abstract processSmsHasEnteredConversation(userInfo: UserInfo, twilioPhoneNumber: string, inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry,
    userAttachments: any[]): Promise<void>;

  protected abstract processSmsReturning(userInfo: UserInfo, twilioPhoneNumber: string, inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry,
    entryPoint: EntryPoint, returningVoter: boolean, userAttachments: any[]): Promise<void>;

  // Method to handle incoming SMS messages.
  public async handleMessage(
    req: Request,
    // TODO: Return a status of some kind, instead of void.
    entryPoint: EntryPoint,
    inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry,
  ): Promise<void> {
    logger.info('Entering ConstituentMessageHandler.handleIncomingSmsMessage');

    const reqBody = req.body as TwilioUtil.TwilioRequestBody;
    const userPhoneNumber = reqBody.From;

    // TODO: Have the logic within this block encapsulated within a method of constituentMessageHandler,
    // so that clients can modify the behavior (e.g. reply with unsubscribe confirmation).
    // Have this be one of the major paths (with constitutent status STOP).
    if (await this.isPhoneNumberBlocked(userPhoneNumber)) {
      logger.info(
        `ConstituentMessageHandler.handleIncomingSmsMessage: Received text from blocked phone number: ${userPhoneNumber}.`
      );
      return;
    }

    const twilioPhoneNumber = reqBody.To;
    const userMessage = reqBody.Body;
    const userAttachments = TwilioUtil.getAttachments(reqBody);
    const MD5 = new Hashes.MD5();
    const userId = MD5.hex(userPhoneNumber);
    this.constituent.id = userId;
    this.constituent.phoneNumber = userPhoneNumber;
    this.constituent.message = userMessage;
    this.userAttachments = userAttachments;
    this.twilioPhoneNumber = twilioPhoneNumber;
    this.entryPoint = entryPoint;
    logger.info(`ConstituentMessageHandler.handleIncomingSmsMessage: Receiving Twilio message from ${entryPoint} entry point voter,
                          userPhoneNumber: ${userPhoneNumber},
                          twilioPhoneNumber: ${twilioPhoneNumber},
                          userMessage: ${userMessage},
                          userId: ${userId}`);

    this.setInboundDbMessageEntry(inboundDbMessageEntry);
    let returningVoter = false;
    let userInfo = await this.fetchAndLoadConstituentInfo(twilioPhoneNumber);
    if (!userInfo) {
      userInfo = this.loadInfoForNewConstituent({
        userPhoneNumber,
        constituentId: userId,
        twilioPhoneNumber,
        entryPoint,
      });
    }
    await this.fetchAndLoadOptOutStatus();
    this.determineConstituentStatus();
    if (config.enableMultiCycleFeature && this.getConstituentStatus() == ConstituentStatus.RETURNING) {
      await this.endConstituentSession(redisClient, userInfo, twilioPhoneNumber);
    }

    logger.info("ConstituentMessageHandler.handleIncomingSmsMessage ConstituentStatus: ", this.getConstituentStatus());
    const constituentIsAllowedToContinue = await this.handleOptOutLogic(twilioPhoneNumber, inboundDbMessageEntry);
    if (!constituentIsAllowedToContinue) return;

    let userOptions;
    switch (this.getConstituentStatus()) {
      /********************
        NEW
      ********************/
      case ConstituentStatus.NEW: {
        this.processSmsNew(userInfo, twilioPhoneNumber, inboundDbMessageEntry);
        break;
      }
      /********************
        PRE_ENTERING_AUTOMATED
      ********************/
      case ConstituentStatus.PRE_ENTERING_AUTOMATED: {
        this.processSmsPreAutomatedEntry(userInfo, twilioPhoneNumber, inboundDbMessageEntry);
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
        this.processSmsHasEnteredAutomated(userInfo, twilioPhoneNumber, inboundDbMessageEntry, userAttachments);
        break;
      }
      /********************
        HAS_ENTERED_CONVERSATION
      ********************/
      case ConstituentStatus.HAS_ENTERED_CONVERSATION: {
        this.processSmsHasEnteredConversation(userInfo, twilioPhoneNumber, inboundDbMessageEntry, userAttachments);
        break;
      }
      /********************
        RETURNING
      ********************/
      case ConstituentStatus.RETURNING: {
        this.processSmsReturning(userInfo, twilioPhoneNumber, inboundDbMessageEntry, entryPoint, returningVoter, userAttachments);
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

    // TODO: Implement this, and include database writes.
    // this.finishHandlingMessage();
  }
}
