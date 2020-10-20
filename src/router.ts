import Hashes from 'jshashes';

import * as MessageConstants from './message_constants';
import * as SlackApiUtil from './slack_api_util';
import * as SlackBlockUtil from './slack_block_util';
import * as TwilioApiUtil from './twilio_api_util';
import * as StateParser from './state_parser';
import * as DbApiUtil from './db_api_util';
import * as RedisApiUtil from './redis_api_util';
import * as LoadBalancer from './load_balancer';
import * as SlackMessageFormatter from './slack_message_formatter';
import * as CommandUtil from './command_util';
import MessageParser from './message_parser';
import * as SlackInteractionApiUtil from './slack_interaction_api_util';
import logger from './logger';
import { EntryPoint, UserInfo } from './types';
import { PromisifiedRedisClient } from './redis_client';
import * as Sentry from '@sentry/node';

const MINS_BEFORE_WELCOME_BACK_MESSAGE = 60 * 24;
export const NUM_STATE_SELECTION_ATTEMPTS_LIMIT = 2;

const VOTED_KEYWORDS = [
  'voted',
  'i voted',
  'already voted',
  'i already voted',
  "i've already voted",
  'i voted already',
  "i've voted already",
];

type UserOptions = {
  userMessage: string;
  userPhoneNumber: string;
};

type AdminCommandParams = {
  commandParentMessageTs: string;
  routingSlackUserName: string;
  previousSlackChannelName: string;
};

export function isVotedMessage(message: string): boolean {
  return VOTED_KEYWORDS.includes(message.toLowerCase().trim());
}

// prepareUserInfoForNewVoter is used by functions that handle
// phone numbers not previously seen.
function prepareUserInfoForNewVoter({
  userOptions,
  twilioPhoneNumber,
  entryPoint,
}: {
  userOptions: UserOptions & { userId: string; userPhoneNumber: string | null };
  twilioPhoneNumber: string;
  entryPoint: EntryPoint;
}): UserInfo {
  let isDemo, confirmedDisclaimer, volunteerEngaged;
  if (entryPoint === LoadBalancer.PULL_ENTRY_POINT) {
    isDemo = LoadBalancer.phoneNumbersAreDemo(
      twilioPhoneNumber,
      userOptions.userPhoneNumber
    );
    logger.debug(
      `ROUTER.prepareUserInfoForNewVoter (${userOptions.userId}): Evaluating isDemo based on userPhoneNumber/twilioPhoneNumber: ${isDemo}`
    );
    confirmedDisclaimer = false;
    volunteerEngaged = false;
  }
  return {
    userId: userOptions.userId,
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
  } as UserInfo;
}

export async function welcomePotentialVoter(
  userOptions: UserOptions & { userId: string },
  redisClient: PromisifiedRedisClient,
  twilioPhoneNumber: string,
  inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry,
  entryPoint: EntryPoint,
  twilioCallbackURL: string
): Promise<void> {
  logger.debug('ENTERING ROUTER.welcomePotentialVoter');
  const userInfo = prepareUserInfoForNewVoter({
    userOptions,
    twilioPhoneNumber,
    entryPoint,
  });

  let message = MessageConstants.WELCOME_VOTER();
  if (
    process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA' &&
    isVotedMessage(inboundDbMessageEntry.message || '')
  ) {
    message = MessageConstants.VOTED_WELCOME_RESPONSE();
    await DbApiUtil.logVoterStatusToDb({
      userId: userInfo.userId,
      userPhoneNumber: userInfo.userPhoneNumber,
      twilioPhoneNumber: twilioPhoneNumber,
      isDemo: LoadBalancer.phoneNumbersAreDemo(
        twilioPhoneNumber,
        userInfo.userPhoneNumber
      ),
      voterStatus: 'VOTED',
      originatingSlackUserName: null,
      originatingSlackUserId: null,
      slackChannelName: null,
      slackChannelId: null,
      slackParentMessageTs: null,
      actionTs: null,
    });
  }
  await TwilioApiUtil.sendMessage(
    message,
    {
      userPhoneNumber: userOptions.userPhoneNumber,
      twilioPhoneNumber,
      twilioCallbackURL,
    },
    DbApiUtil.populateAutomatedDbMessageEntry(userInfo)
  );

  DbApiUtil.updateDbMessageEntryWithUserInfo(userInfo!, inboundDbMessageEntry);

  // The message isn't being relayed, so don't fill this field in Postgres.
  inboundDbMessageEntry.successfullySent = null;
  try {
    await DbApiUtil.logMessageToDb(inboundDbMessageEntry);
  } catch (error) {
    logger.info(
      `ROUTER.welcomePotentialVoter: failed to log incoming voter message to DB`
    );
    Sentry.captureException(error);
  }

  // Add key/value such that given a user phone number we can see
  // that the voter has been encountered before, even if there is not
  // yet any Slack channel/thread info for this voter.
  logger.debug(
    `ROUTER.welcomePotentialVoter: Writing new voter userInfo to Redis.`
  );
  await RedisApiUtil.setHash(
    redisClient,
    `${userInfo.userId}:${twilioPhoneNumber}`,
    userInfo
  );
}

const introduceNewVoterToSlackChannel = async (
  { userInfo, userMessage }: { userInfo: UserInfo; userMessage: string },
  redisClient: PromisifiedRedisClient,
  twilioPhoneNumber: string,
  inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry,
  entryPoint: EntryPoint,
  slackChannelName: string,
  twilioCallbackURL: string,
  // This is only used by VOTE_AMERICA
  includeWelcome?: boolean
) => {
  logger.debug('ENTERING ROUTER.introduceNewVoterToSlackChannel');
  logger.debug(
    `ROUTER.introduceNewVoterToSlackChannel: Updating lastVoterMessageSecsFromEpoch to ${userInfo.lastVoterMessageSecsFromEpoch}`
  );

  logger.debug(
    `ROUTER.introduceNewVoterToSlackChannel: Announcing new voter via new thread in ${slackChannelName}.`
  );
  // In Slack, create entry channel message, followed by voter's message and intro text.
  const operatorMessage = `*User ID:* ${userInfo.userId}\n*Connected via:* ${twilioPhoneNumber} (${entryPoint})`;

  const slackBlocks = SlackBlockUtil.getVoterStatusBlocks(operatorMessage);

  const response = await SlackApiUtil.sendMessage(operatorMessage, {
    channel: slackChannelName,
    blocks: slackBlocks,
  });

  let messageToVoter;
  if (process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA') {
    if (includeWelcome) {
      // Voter initiated conversation with "HELPLINE".
      messageToVoter = MessageConstants.WELCOME_AND_STATE_QUESTION();
    } else {
      // Voter has already received automated welcome and is just now responding with "HELPLINE".
      messageToVoter = MessageConstants.STATE_QUESTION();
    }
  } else {
    messageToVoter = MessageConstants.WELCOME_VOTER();
  }

  if (response) {
    if (entryPoint === LoadBalancer.PULL_ENTRY_POINT) {
      logger.debug(
        `ROUTER.introduceNewVoterToSlackChannel: Entry point is PULL, so sending automated welcome to voter.`
      );
      // Welcome the voter
      await TwilioApiUtil.sendMessage(
        messageToVoter,
        {
          userPhoneNumber: userInfo.userPhoneNumber,
          twilioPhoneNumber,
          twilioCallbackURL,
        },
        DbApiUtil.populateAutomatedDbMessageEntry(userInfo)
      );
    }
  } else {
    await TwilioApiUtil.sendMessage(
      `There was an unexpected error sending your message. Please wait a few minutes and try again.`,
      {
        userPhoneNumber: userInfo.userPhoneNumber,
        twilioPhoneNumber,
        twilioCallbackURL,
      },
      DbApiUtil.populateAutomatedDbMessageEntry(userInfo)
    );
    throw new Error(
      `Could not send introduction slack message with voter info for voter ${userInfo.userPhoneNumber} texting ${twilioPhoneNumber}`
    );
  }

  logger.debug(`ROUTER.introduceNewVoterToSlackChannel: Successfully announced new voter via new thread in ${slackChannelName},
                response.data.channel: ${response.data.channel},
                response.data.ts: ${response.data.ts}`);

  // Remember the thread for this user and this channel,
  // using the ID version of the channel.
  userInfo[response.data.channel] = response.data.ts;

  // Create the thread
  await DbApiUtil.logThreadToDb({
    slackParentMessageTs: response.data.ts,
    channelId: response.data.channel,
    userId: userInfo.userId,
    userPhoneNumber: userInfo.userPhoneNumber,
    needsAttention: true,
  });

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
      `ROUTER.introduceNewVoterToSlackChannel: Retrieving and passing message history to Slack, slackChannelName: ${slackChannelName}, parentMessageTs: ${response.data.channel}.`
    );

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
        `ROUTER.introduceNewVoterToSlackChannel: failed to log incoming voter message to DB`
      );
      Sentry.captureException(error);
    }

    const messageHistoryContextText =
      "Below is the voter's message history so far.";
    await postUserMessageHistoryToSlack(
      userInfo.userId,
      '1990-01-01 10:00:00.000',
      messageHistoryContextText,
      {
        destinationSlackParentMessageTs: response.data.ts,
        destinationSlackChannelId: response.data.channel,
      }
    );
  } else if (entryPoint === LoadBalancer.PULL_ENTRY_POINT) {
    // Pass the voter's message along to the initial Slack channel thread,
    // and show in the Slack thread the welcome message the voter received
    // in response.
    logger.debug(
      `ROUTER.introduceNewVoterToSlackChannel: Passing voter message to Slack, slackChannelName: ${slackChannelName}, parentMessageTs: ${response.data.ts}.`
    );
    await SlackApiUtil.sendMessage(
      `${userMessage}`,
      {
        parentMessageTs: response.data.ts,
        channel: response.data.channel,
        isVoterMessage: true,
      },
      inboundDbMessageEntry,
      userInfo
    );

    logger.debug(
      `ROUTER.introduceNewVoterToSlackChannel: Passing automated welcome message to Slack, slackChannelName: ${slackChannelName}, parentMessageTs: ${response.data.channel}.`
    );
    await SlackApiUtil.sendMessage(`*Automated Message:* ${messageToVoter}`, {
      parentMessageTs: response.data.ts,
      channel: response.data.channel,
    });
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

  // Add key/value such that given Slack thread data we can get a
  // user phone number.
  logger.debug(
    `ROUTER.introduceNewVoterToSlackChannel: Writing updated Slack-to-Twilio redisData to Redis.`
  );
  await RedisApiUtil.setHash(
    redisClient,
    `${response.data.channel}:${response.data.ts}`,
    { userPhoneNumber: userInfo.userPhoneNumber, twilioPhoneNumber }
  );
};

export async function handleNewVoter(
  userOptions: UserOptions & { userId: string },
  redisClient: PromisifiedRedisClient,
  twilioPhoneNumber: string,
  inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry,
  entryPoint: EntryPoint,
  twilioCallbackURL: string,
  includeWelcome?: boolean
): Promise<void> {
  logger.debug('ENTERING ROUTER.handleNewVoter');
  const userMessage = userOptions.userMessage;
  const userInfo = prepareUserInfoForNewVoter({
    userOptions,
    twilioPhoneNumber,
    entryPoint,
  });

  await DbApiUtil.logInitialVoterStatusToDb(
    userInfo.userId,
    userOptions.userPhoneNumber,
    twilioPhoneNumber
  );

  let slackChannelName = userInfo.isDemo ? 'demo-lobby' : 'lobby';
  if (entryPoint === LoadBalancer.PULL_ENTRY_POINT) {
    logger.debug(
      `ROUTER.handleNewVoter (${userInfo.userId}): New voter will enter Slack channel: ${slackChannelName}`
    );
  } else if (entryPoint === LoadBalancer.PUSH_ENTRY_POINT) {
    userInfo.stateName = LoadBalancer.getPushPhoneNumberState(
      twilioPhoneNumber
    );
    logger.debug(
      `ROUTER.handleNewVoter (${userInfo.userId}): Determined that twilioPhoneNumber ${twilioPhoneNumber} corresponds to U.S. state ${userInfo.stateName} based on hard coding in LoadBalancer.`
    );
    const selectedChannelName = await LoadBalancer.selectSlackChannel(
      redisClient,
      LoadBalancer.PUSH_ENTRY_POINT,
      userInfo.stateName
    );

    logger.debug(
      `ROUTER.handleNewVoter (${userInfo.userId}): LoadBalancer returned Slack channel ${selectedChannelName} for new PUSH voter.`
    );
    if (selectedChannelName) {
      slackChannelName = selectedChannelName;
    } else {
      // If LoadBalancer didn't find a Slack channel, then select #national or #demo-national as fallback.
      slackChannelName = userInfo.isDemo ? 'demo-national' : 'national';
      logger.error(
        `ROUTER.handleNewVoter (${userInfo.userId}): ERROR LoadBalancer did not find a Slack channel for new PUSH voter. Using ${slackChannelName} as fallback.`
      );
    }
  }

  await introduceNewVoterToSlackChannel(
    { userInfo: userInfo as UserInfo, userMessage },
    redisClient,
    twilioPhoneNumber,
    inboundDbMessageEntry,
    entryPoint,
    slackChannelName,
    twilioCallbackURL,
    includeWelcome
  );
}

const postUserMessageHistoryToSlack = async (
  userId: string,
  timestampOfLastMessageInThread: string,
  messageHistoryContextText: string,
  {
    destinationSlackParentMessageTs,
    destinationSlackChannelId,
  }: {
    destinationSlackParentMessageTs: string;
    destinationSlackChannelId: string;
  }
) => {
  logger.debug('ENTERING ROUTER.postUserMessageHistoryToSlack');
  const messageHistory = await DbApiUtil.getMessageHistoryFor(
    userId,
    timestampOfLastMessageInThread
  );

  // Just in case.
  if (!messageHistory) {
    logger.debug(
      'ROUTER.postUserMessageHistoryToSlack: No message history found.'
    );
    return;
  }

  logger.debug(
    'ROUTER.postUserMessageHistoryToSlack: Message history found, formatting it by calling SlackMessageFormatter.'
  );
  const formattedMessageHistory = SlackMessageFormatter.formatMessageHistory(
    messageHistory,
    userId.substring(0, 5)
  );

  const msgInfo = await SlackApiUtil.sendMessage(
    `*Operator:* ${messageHistoryContextText}\n\n${formattedMessageHistory}`,
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
  }
};

// This helper handles all tasks associated with routing a voter to a new
// channel that require the new channel's thread.
const routeVoterToSlackChannelHelper = async (
  userInfo: UserInfo,
  redisClient: PromisifiedRedisClient,
  twilioPhoneNumber: string,
  {
    destinationSlackChannelName,
    destinationSlackChannelId,
    destinationSlackParentMessageTs,
  }: {
    destinationSlackChannelName: string;
    destinationSlackChannelId: string;
    destinationSlackParentMessageTs: string;
  },
  timestampOfLastMessageInThread?: string
) => {
  logger.debug('ENTERING ROUTER.routeVoterToSlackChannelHelper');
  logger.debug(`ROUTER.routeVoterToSlackChannelHelper: Voter is being routed to,
                destinationSlackChannelId: ${destinationSlackChannelId},
                destinationSlackParentMessageTs: ${destinationSlackParentMessageTs},
                destinationSlackChannelName: ${destinationSlackChannelName}`);

  let messageHistoryContextText =
    'Below are our messages with the voter since they left this thread.';
  // If voter is new to a channel/thread, retrieve all message history. If a
  // voter is returning to a channel/thread, timestamp should be passed, used
  // to only retrieve messages since the voter left that thread.
  if (!timestampOfLastMessageInThread) {
    logger.debug(
      'ROUTER.routeVoterToSlackChannelHelper: Voter HAS NOT been to this channel before.'
    );
    // If timestamp isn't passed, voter is new to channel. Retrieve full message history.
    timestampOfLastMessageInThread = '1990-01-01 10:00:00.000';
    messageHistoryContextText = "Below is the voter's message history so far.";
  } else {
    logger.debug(
      'ROUTER.routeVoterToSlackChannelHelper: Voter HAS been to this channel before.'
    );
  }

  logger.debug(
    "ROUTER.routeVoterToSlackChannelHelper: Changing voter's active channel."
  );
  // Reassign the active channel so that the next voter messages go to the
  // new active channel.
  userInfo.activeChannelId = destinationSlackChannelId;
  userInfo.activeChannelName = destinationSlackChannelName;

  // Update userInfo in Redis (remember state channel thread identifying info and new activeChannel).
  logger.debug(
    `ROUTER.routeVoterToSlackChannelHelper: Writing updated userInfo to Redis.`
  );

  await RedisApiUtil.setHash(
    redisClient,
    `${userInfo.userId}:${twilioPhoneNumber}`,
    userInfo
  );

  // Populate state channel thread with message history so far.
  await postUserMessageHistoryToSlack(
    userInfo.userId,
    timestampOfLastMessageInThread,
    messageHistoryContextText,
    { destinationSlackParentMessageTs, destinationSlackChannelId }
  );
};

// This function routes a voter to a new channel WHETHER OR NOT they have
// previously been to that channel before, creating a new thread if needed.
const routeVoterToSlackChannel = async (
  userInfo: UserInfo,
  redisClient: PromisifiedRedisClient,
  {
    userId,
    twilioPhoneNumber,
    destinationSlackChannelName,
  }: {
    userId: string;
    twilioPhoneNumber: string;
    destinationSlackChannelName: string;
  },
  adminCommandParams?: AdminCommandParams /* only for admin re-routes (not automated)*/
) => {
  logger.debug('ENTERING ROUTER.routeVoterToSlackChannel');
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
    `ROUTER.routeVoterToSlackChannel: Determined destination Slack channel ID: ${destinationSlackChannelId}`
  );

  // If a destinationSlackChannelId was not fetched from Redis, refresh Redis's slackPodChannelIds cache
  // data via a call to Slack's conversation.list API and try again.
  if (!destinationSlackChannelId) {
    logger.debug(
      `ROUTER.routeVoterToSlackChannel: destinationSlackChannelId (${destinationSlackChannelId}) not found in Redis, refreshing slackPodChannelIds key using Slack conversations.list call.`
    );
    await SlackApiUtil.updateSlackChannelNamesAndIdsInRedis(redisClient);
    slackChannelIds = await RedisApiUtil.getHash(
      redisClient,
      'slackPodChannelIds'
    );
    destinationSlackChannelId = slackChannelIds[destinationSlackChannelName];
    logger.debug(
      `ROUTER.routeVoterToSlackChannel: Resulting Slack channel ID using Slack channel name (${destinationSlackChannelName}) after Slack conversations.list call: ${destinationSlackChannelId}`
    );
  }

  // Operations for successful ADMIN route of voter.
  if (adminCommandParams) {
    // Error catching for admin command: destination channel not found.
    if (!destinationSlackChannelId) {
      logger.debug(
        'ROUTER.routeVoterToSlackChannel: destinationSlackChannelId not found. Did you forget to add it to slackPodChannelIds in Redis? Or if this is an admin action, did the admin type it wrong?'
      );
      await SlackApiUtil.sendMessage(
        `*Operator:* Slack channel ${destinationSlackChannelName} not found.`,
        {
          channel: process.env.ADMIN_CONTROL_ROOM_SLACK_CHANNEL_ID!,
          parentMessageTs: adminCommandParams.commandParentMessageTs,
        }
      );
      return;
    }

    // TODO: This should probably be a lot later in the routing of the voter.
    logger.debug(
      'ROUTER.routeVoterToSlackChannel: Routing of voter should succeed from here on out. Letting the admin (if applicable) know.'
    );
    await SlackApiUtil.sendMessage(`*Operator:* Operation successful.`, {
      channel: process.env.ADMIN_CONTROL_ROOM_SLACK_CHANNEL_ID!,
      parentMessageTs: adminCommandParams.commandParentMessageTs,
    });
    await SlackApiUtil.sendMessage(
      `*Operator:* Voter is being routed to *${destinationSlackChannelName}* by *${adminCommandParams.routingSlackUserName}*.`,
      {
        channel: userInfo.activeChannelId,
        parentMessageTs: userInfo[userInfo.activeChannelId],
      }
    );
    // Operations for AUTOMATED route of voter.
  } else {
    await SlackApiUtil.sendMessage(
      `*Operator:* Routing voter to *${destinationSlackChannelName}*.`,
      {
        channel: userInfo.activeChannelId,
        parentMessageTs: userInfo[userInfo.activeChannelId],
      }
    );
  }

  // The old thread no longer needs attention
  const needsAttention = await DbApiUtil.getThreadNeedsAttentionFor(
    userInfo[userInfo.activeChannelId],
    userInfo.activeChannelId
  );
  await DbApiUtil.setThreadNeedsAttentionToDb(
    userInfo[userInfo.activeChannelId],
    userInfo.activeChannelId,
    false
  );

  // Remove the voter status panel from the old thread, in which the voter is no longer active.
  // Note: First we need to fetch the old thread parent message blocks, for both 1. the
  // text to be preserved when changing the parent message, and for 2. the other
  // blocks to be transferred to the new thread.
  const previousParentMessageBlocks = await SlackApiUtil.fetchSlackMessageBlocks(
    userInfo.activeChannelId,
    userInfo[userInfo.activeChannelId]
  );

  if (!previousParentMessageBlocks) {
    throw new Error('Unable to retrieve previousParentMessageBlocks');
  }

  // return SlackBlockUtil.populateDropdownWithLatestVoterStatus(previousParentMessageBlocks, userId).then(() => {
  // make deep copy of previousParentMessageBlocks
  const closedVoterPanelMessage = `Voter has been routed to ${SlackApiUtil.linkToSlackChannel(
    destinationSlackChannelId,
    destinationSlackChannelName
  )}.`;
  const closedVoterPanelBlocks = SlackBlockUtil.makeClosedVoterPanelBlocks(
    closedVoterPanelMessage,
    false /* include undo button */
  );

  // Note: It's important not to modify previousParentMessageBlocks here because it may be used again below.
  // Its panel is modified in its origin and it's message is modified to move its panel to destination.
  const newPrevParentMessageBlocks = [previousParentMessageBlocks[0]].concat(
    closedVoterPanelBlocks
  );

  await SlackInteractionApiUtil.replaceSlackMessageBlocks({
    slackChannelId: userInfo.activeChannelId,
    slackParentMessageTs: userInfo[userInfo.activeChannelId],
    newBlocks: newPrevParentMessageBlocks,
  });

  logger.debug(
    'ROUTER.routeVoterToSlackChannel: Successfully updated old thread parent message during channel move'
  );

  // If this user hasn't been to the destination channel, create new thread in the channel.
  if (!userInfo[destinationSlackChannelId]) {
    logger.debug(
      `ROUTER.routeVoterToSlackChannel: Creating a new thread in this channel (${destinationSlackChannelId}), since voter hasn't been here.`
    );
    let newParentMessageText = `<!channel> New ${userInfo.stateName} voter!\n*User ID:* ${userId}\n*Connected via:* ${twilioPhoneNumber} (${userInfo.entryPoint})`;
    if (adminCommandParams) {
      newParentMessageText = `<!channel> Voter routed from *${adminCommandParams.previousSlackChannelName}* by *${adminCommandParams.routingSlackUserName}*\n*User ID:* ${userId}\n*Connected via:* ${twilioPhoneNumber} (${userInfo.entryPoint})`;
    }

    // Use the same blocks as from the voter's previous active thread parent message, except for the voter info text.
    if (previousParentMessageBlocks[0] && previousParentMessageBlocks[0].text) {
      previousParentMessageBlocks[0].text.text = newParentMessageText;
    } else {
      logger.error(
        'ROUTER.routeVoterToSlackChannel: ERROR replacing voter info text above voter panel blocks that are being moved.'
      );
    }

    // Note: The parent message text is actually populated via the blocks.
    const response = await SlackApiUtil.sendMessage(newParentMessageText, {
      channel: destinationSlackChannelName,
      blocks: previousParentMessageBlocks,
    });

    if (!response) {
      throw new Error('Unable to send newParentMessageText as a Slack message');
    }

    // Remember the voter's thread in this channel.
    userInfo[response.data.channel] = response.data.ts;

    // Create the thread with the origin thread's need_attention status
    await DbApiUtil.logThreadToDb({
      slackParentMessageTs: response.data.ts,
      channelId: response.data.channel,
      userId: userInfo.userId,
      userPhoneNumber: userInfo.userPhoneNumber,
      needsAttention: needsAttention,
    });

    // Be able to identify phone number using NEW Slack channel identifying info.
    await RedisApiUtil.setHash(
      redisClient,
      `${response.data.channel}:${response.data.ts}`,
      { userPhoneNumber, twilioPhoneNumber }
    );

    // The logic above this is for a voter's first time at a channel (e.g. create thread).
    // This function is separated so that it could be used to return a voter to
    // their thread in a channel they've already been in.
    await routeVoterToSlackChannelHelper(
      userInfo,
      redisClient,
      twilioPhoneNumber,
      {
        destinationSlackChannelName,
        destinationSlackChannelId: response.data.channel,
        destinationSlackParentMessageTs: response.data.ts,
      }
    );

    return;
  }
  // If this user HAS been to the destination channel, use the same thread info.

  if (!adminCommandParams) {
    throw new Error('Missing adminCommandParams');
  }

  // Fetch the blocks of the parent message of the destination thread to which the voter is returning.
  const destinationParentMessageBlocks = await SlackApiUtil.fetchSlackMessageBlocks(
    destinationSlackChannelId,
    userInfo[destinationSlackChannelId]
  );

  if (!destinationParentMessageBlocks) {
    throw new Error('Unable to get destinationParentMessageBlocks');
  }

  // Preserve the voter info message of the destination thread to which the voter is returning, but otherwise use the blocks of the previous thread in which the voter was active.
  if (previousParentMessageBlocks[0] && previousParentMessageBlocks[0].text) {
    previousParentMessageBlocks[0].text.text =
      destinationParentMessageBlocks[0].text.text;
  } else {
    logger.error(
      'ROUTER.routeVoterToSlackChannel: ERROR replacing voter info text above voter panel blocks that are being moved.'
    );
  }

  await SlackInteractionApiUtil.replaceSlackMessageBlocks({
    slackChannelId: destinationSlackChannelId,
    slackParentMessageTs: userInfo[destinationSlackChannelId],
    newBlocks: previousParentMessageBlocks,
  });

  logger.debug(
    `ROUTER.routeVoterToSlackChannel: Returning voter back to *${destinationSlackChannelName}* from *${adminCommandParams.previousSlackChannelName}*. Voter has been here before.`
  );

  await SlackApiUtil.sendMessage(
    `*Operator:* Voter *${userId}* was routed from *${adminCommandParams.previousSlackChannelName}* back to this channel by *${adminCommandParams.routingSlackUserName}*. See their thread with *${twilioPhoneNumber}* above.`,
    { channel: destinationSlackChannelId }
  );

  const timestampOfLastMessageInThread = await DbApiUtil.getTimestampOfLastMessageInThread(
    userInfo[destinationSlackChannelId]
  );

  logger.debug(
    `timestampOfLastMessageInThread: ${timestampOfLastMessageInThread}`
  );

  // Set destination thread to have same needs_attention status as origin thread
  await DbApiUtil.setThreadNeedsAttentionToDb(
    userInfo[destinationSlackChannelId],
    destinationSlackChannelId,
    needsAttention
  );

  await SlackApiUtil.sendMessage(
    `*Operator:* Voter *${userId}* was routed from *${adminCommandParams.previousSlackChannelName}* back to this thread by *${adminCommandParams.routingSlackUserName}*. Messages sent here will again relay to the voter.`,
    {
      channel: destinationSlackChannelId,
      parentMessageTs: userInfo[destinationSlackChannelId],
    }
  );

  await routeVoterToSlackChannelHelper(
    userInfo,
    redisClient,
    twilioPhoneNumber,
    {
      destinationSlackChannelName,
      destinationSlackChannelId,
      destinationSlackParentMessageTs: userInfo[destinationSlackChannelId],
    },
    timestampOfLastMessageInThread
  );
};

export async function determineVoterState(
  userOptions: UserOptions & { userInfo: UserInfo },
  redisClient: PromisifiedRedisClient,
  twilioPhoneNumber: string,
  inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry,
  twilioCallbackURL: string
): Promise<void> {
  logger.debug('ENTERING ROUTER.determineVoterState');
  const userInfo = userOptions.userInfo;
  const userPhoneNumber = userOptions.userPhoneNumber;
  const userId = userInfo.userId;
  const userMessage = userOptions.userMessage;

  userInfo.numStateSelectionAttempts++;

  userInfo.lastVoterMessageSecsFromEpoch = Math.round(Date.now() / 1000);
  logger.debug(
    `ROUTER.determineVoterState: Updating lastVoterMessageSecsFromEpoch to ${userInfo.lastVoterMessageSecsFromEpoch}`
  );

  const lobbyChannelId = userInfo.activeChannelId;
  const lobbyParentMessageTs = userInfo[lobbyChannelId];

  logger.debug(
    `ROUTER.determineVoterState: Passing voter message to Slack, slackChannelName: ${lobbyChannelId}, parentMessageTs: ${lobbyParentMessageTs}.`
  );
  await SlackApiUtil.sendMessage(
    `${userMessage}`,
    {
      parentMessageTs: lobbyParentMessageTs,
      channel: lobbyChannelId,
      isVoterMessage: true,
    },
    inboundDbMessageEntry,
    userInfo
  );

  let stateName = StateParser.determineState(userMessage);

  if (stateName == null) {
    // If we've tried to determine their U.S. state enough times, choose the National channel
    // and let the voter know a volunteer is being sought.
    if (userInfo.numStateSelectionAttempts >= 2) {
      stateName = 'National';
      // Otherwise, try to determine their U.S. state one more time.
    } else {
      logger.debug(
        `ROUTER.determineVoterState: StateParser could not determine U.S. state of voter from message ${userMessage}`
      );

      await TwilioApiUtil.sendMessage(
        MessageConstants.CLARIFY_STATE(),
        { userPhoneNumber, twilioPhoneNumber, twilioCallbackURL },
        DbApiUtil.populateAutomatedDbMessageEntry(userInfo)
      );
      await SlackApiUtil.sendMessage(
        `*Automated Message:* ${MessageConstants.CLARIFY_STATE()}`,
        {
          parentMessageTs: lobbyParentMessageTs,
          channel: lobbyChannelId,
        }
      );

      logger.debug(
        `ROUTER.determineVoterState: Writing updated userInfo to Redis.`
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
    `ROUTER.determineVoterState: StateParser reviewed ${userMessage} and determined U.S. state: ${stateName}`
  );

  const messageToVoter =
    userInfo.stateName === 'National'
      ? MessageConstants.NO_STATE_FINDING_VOLUNTEER()
      : MessageConstants.STATE_CONFIRMATION(stateName);

  await TwilioApiUtil.sendMessage(
    messageToVoter,
    { userPhoneNumber, twilioPhoneNumber, twilioCallbackURL },
    DbApiUtil.populateAutomatedDbMessageEntry(userInfo)
  );
  await SlackApiUtil.sendMessage(`*Automated Message:* ${messageToVoter}`, {
    parentMessageTs: lobbyParentMessageTs,
    channel: lobbyChannelId,
  });

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
      `ROUTER.determineVoterState: ERROR in selecting U.S. state channel. Defaulting to ${selectedStateChannelName}.`
    );
  } else {
    logger.debug(
      `ROUTER.determineVoterState: U.S. state channel successfully selected: ${selectedStateChannelName}`
    );
  }

  await routeVoterToSlackChannel(userInfo, redisClient, {
    userId,
    twilioPhoneNumber,
    destinationSlackChannelName: selectedStateChannelName,
  });
}

export async function clarifyHelplineRequest(
  userOptions: UserOptions & { userInfo: UserInfo },
  redisClient: PromisifiedRedisClient,
  twilioPhoneNumber: string,
  inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry,
  twilioCallbackURL: string
): Promise<void> {
  logger.debug('ENTERING ROUTER.clarifyHelplineRequest');
  const userInfo = userOptions.userInfo;
  userInfo.lastVoterMessageSecsFromEpoch = Math.round(Date.now() / 1000);

  await TwilioApiUtil.sendMessage(
    MessageConstants.CLARIFY_HELPLINE_REQUEST(),
    {
      userPhoneNumber: userOptions.userPhoneNumber,
      twilioPhoneNumber,
      twilioCallbackURL,
    },
    DbApiUtil.populateAutomatedDbMessageEntry(userInfo)
  );

  DbApiUtil.updateDbMessageEntryWithUserInfo(userInfo!, inboundDbMessageEntry);

  // The message isn't being relayed, so don't fill this field in Postgres.
  inboundDbMessageEntry.successfullySent = null;
  try {
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
}

export async function handleDisclaimer(
  userOptions: UserOptions & { userInfo: UserInfo },
  redisClient: PromisifiedRedisClient,
  twilioPhoneNumber: string,
  inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry,
  twilioCallbackURL: string
): Promise<void> {
  logger.debug('ENTERING ROUTER.handleDisclaimer');
  const userInfo = userOptions.userInfo;
  const userId = userInfo.userId;
  const userMessage = userOptions.userMessage;
  const slackLobbyMessageParams = {
    parentMessageTs: userInfo[userInfo.activeChannelId],
    channel: userInfo.activeChannelId,
  };

  logger.debug(
    `ROUTER.handleDisclaimer: Updating lastVoterMessageSecsFromEpoch to ${userInfo.lastVoterMessageSecsFromEpoch}`
  );
  userInfo.lastVoterMessageSecsFromEpoch = Math.round(Date.now() / 1000);

  await SlackApiUtil.sendMessage(
    `${userMessage}`,
    { ...slackLobbyMessageParams, isVoterMessage: true },
    inboundDbMessageEntry,
    userInfo
  );

  const userMessageNoPunctuation = userOptions.userMessage.replace(
    /[.,?/#!$%^&*;:{}=\-_`~()]/g,
    ''
  );
  const cleared = userMessageNoPunctuation.toLowerCase().trim() == 'agree';
  let automatedMessage;
  if (cleared) {
    logger.debug(
      `ROUTER.handleDisclaimer: Voter cleared disclaimer with message ${userMessage}.`
    );
    userInfo.confirmedDisclaimer = true;
    automatedMessage = MessageConstants.STATE_QUESTION();
  } else {
    logger.debug(
      `ROUTER.handleDisclaimer: Voter did not clear disclaimer with message ${userMessage}.`
    );
    automatedMessage = MessageConstants.CLARIFY_DISCLAIMER();
  }

  await RedisApiUtil.setHash(
    redisClient,
    `${userId}:${twilioPhoneNumber}`,
    userInfo
  );
  await TwilioApiUtil.sendMessage(
    automatedMessage,
    {
      userPhoneNumber: userOptions.userPhoneNumber,
      twilioPhoneNumber,
      twilioCallbackURL,
    },
    DbApiUtil.populateAutomatedDbMessageEntry(userInfo)
  );
  await SlackApiUtil.sendMessage(
    `*Automated Message:* ${automatedMessage}`,
    slackLobbyMessageParams
  );
}

export async function handleClearedVoter(
  userOptions: UserOptions & { userInfo: UserInfo },
  redisClient: PromisifiedRedisClient,
  twilioPhoneNumber: string,
  inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry,
  twilioCallbackURL: string
): Promise<void> {
  logger.debug('ENTERING ROUTER.handleClearedVoter');
  const userInfo = userOptions.userInfo;
  const userId = userInfo.userId;
  const activeChannelMessageParams = {
    parentMessageTs: userInfo[userInfo.activeChannelId],
    channel: userInfo.activeChannelId,
  };

  const nowSecondsEpoch = Math.round(Date.now() / 1000);
  // Remember the lastVoterMessageSecsFromEpoch, for use in calculation below.
  const lastVoterMessageSecsFromEpoch = userInfo.lastVoterMessageSecsFromEpoch;
  // Update the lastVoterMessageSecsFromEpoch, for use in DB write below.
  userInfo.lastVoterMessageSecsFromEpoch = nowSecondsEpoch;

  await SlackApiUtil.sendMessage(
    `${userOptions.userMessage}`,
    { ...activeChannelMessageParams, isVoterMessage: true },
    inboundDbMessageEntry,
    userInfo
  );

  logger.debug(
    `ROUTER.handleClearedVoter: Seconds since last message from voter: ${
      nowSecondsEpoch - lastVoterMessageSecsFromEpoch
    }`
  );

  if (
    nowSecondsEpoch - lastVoterMessageSecsFromEpoch >
    MINS_BEFORE_WELCOME_BACK_MESSAGE * 60
  ) {
    logger.debug(
      `ROUTER.handleClearedVoter: Seconds since last message from voter > MINS_BEFORE_WELCOME_BACK_MESSAGE (${
        nowSecondsEpoch - lastVoterMessageSecsFromEpoch
      } > : ${MINS_BEFORE_WELCOME_BACK_MESSAGE}), sending welcome back message.`
    );
    const welcomeBackMessage = MessageConstants.WELCOME_BACK();
    await TwilioApiUtil.sendMessage(
      welcomeBackMessage,
      {
        userPhoneNumber: userOptions.userPhoneNumber,
        twilioPhoneNumber,
        twilioCallbackURL,
      },
      DbApiUtil.populateAutomatedDbMessageEntry(userInfo)
    );
    await SlackApiUtil.sendMessage(
      `*Automated Message:* ${welcomeBackMessage}`,
      activeChannelMessageParams
    );
  }

  logger.debug(`ROUTER.handleClearedVoter: Writing updated userInfo to Redis.`);
  await RedisApiUtil.setHash(
    redisClient,
    `${userId}:${twilioPhoneNumber}`,
    userInfo
  );
}

export async function handleSlackVoterThreadMessage(
  reqBody: SlackEventRequestBody,
  redisClient: PromisifiedRedisClient,
  redisData: UserInfo,
  originatingSlackUserName: string,
  twilioCallbackURL: string,
  {
    retryCount,
    retryReason,
  }: { retryCount: number | undefined; retryReason: string | undefined }
): Promise<void> {
  logger.debug('ENTERING ROUTER.handleSlackVoterThreadMessage');
  const userPhoneNumber = redisData.userPhoneNumber;
  const twilioPhoneNumber = redisData.twilioPhoneNumber;
  if (!userPhoneNumber) {
    return;
  }

  logger.debug(
    `ROUTER.handleSlackVoterThreadMessage: Successfully determined userPhoneNumber from Redis`
  );
  const unprocessedSlackMessage = reqBody.event.text;
  logger.debug(
    `Received message from Slack (channel ${reqBody.event.channel} ts ${reqBody.event.ts}): ${unprocessedSlackMessage}`
  );

  // If the message doesn't need processing.
  let messageToSend = unprocessedSlackMessage;
  let unprocessedMessageToLog = null;
  const processedSlackMessage = MessageParser.processMessageText(
    unprocessedSlackMessage
  );
  // If the message did need processing.
  if (processedSlackMessage != null) {
    messageToSend = processedSlackMessage;
    unprocessedMessageToLog = unprocessedSlackMessage;
  }

  const MD5 = new Hashes.MD5();
  const userId = MD5.hex(userPhoneNumber);

  const outboundDbMessageEntry = DbApiUtil.populateIncomingDbMessageSlackEntry({
    originatingSlackUserName,
    originatingSlackUserId: reqBody.event.user,
    slackChannel: reqBody.event.channel,
    slackParentMessageTs: reqBody.event.thread_ts,
    slackMessageTs: reqBody.event.ts,
    unprocessedMessage: unprocessedMessageToLog,
    slackRetryNum: retryCount,
    slackRetryReason: retryReason,
  });

  const userInfo = (await RedisApiUtil.getHash(
    redisClient,
    `${userId}:${twilioPhoneNumber}`
  )) as UserInfo;
  // Only relay Slack messages from the active Slack thread.
  if (userInfo.activeChannelId === reqBody.event.channel) {
    userInfo.lastVoterMessageSecsFromEpoch = Math.round(Date.now() / 1000);
    if (!userInfo.volunteerEngaged) {
      logger.debug('Router: volunteer engaged, suppressing automated system.');
      userInfo.volunteerEngaged = true;
    }
    await RedisApiUtil.setHash(
      redisClient,
      `${userId}:${twilioPhoneNumber}`,
      userInfo
    );
    await DbApiUtil.updateDbMessageEntryWithUserInfo(
      userInfo,
      outboundDbMessageEntry
    );

    await TwilioApiUtil.sendMessage(
      messageToSend,
      {
        userPhoneNumber,
        twilioPhoneNumber,
        twilioCallbackURL,
        deduplicationId: `${reqBody.event.channel}:${reqBody.event.ts}`,
      },
      outboundDbMessageEntry
    );
    // Slack message is from inactive Slack thread.
  } else {
    await SlackApiUtil.sendMessage(
      `*Operator:* Your message was not relayed, as this thread is inactive. The voter's active thread is in ${userInfo.activeChannelName}.`,
      {
        channel: reqBody.event.channel,
        parentMessageTs: reqBody.event.thread_ts,
      }
    );
  }
}

export type SlackEventRequestBody = {
  event: {
    type: string;
    hidden: boolean;
    text: string;
    ts: string;
    thread_ts: string;
    user: string;
    channel: string;
  };
  authed_users: string[];
};

export async function handleSlackAdminCommand(
  reqBody: SlackEventRequestBody,
  redisClient: PromisifiedRedisClient,
  originatingSlackUserName: string
): Promise<void> {
  logger.debug(' ENTERING ROUTER.handleSlackAdminCommand');
  const adminCommandArgs = CommandUtil.parseSlackCommand(reqBody.event.text);
  logger.debug(
    `ROUTER.handleSlackAdminCommand: Parsed admin control command params: ${JSON.stringify(
      adminCommandArgs
    )}`
  );
  if (!adminCommandArgs) {
    await SlackApiUtil.sendMessage(
      `*Operator:* Your command could not be parsed (did you closely follow the required format)?`,
      {
        channel: process.env.ADMIN_CONTROL_ROOM_SLACK_CHANNEL_ID!,
        parentMessageTs: reqBody.event.ts,
      }
    );
    return;
  }

  switch (adminCommandArgs.command) {
    case CommandUtil.ROUTE_VOTER: {
      // TODO: Move some of this logic to CommandUtil, so this switch statement
      // is cleaner.
      const redisHashKey = `${adminCommandArgs.userId}:${adminCommandArgs.twilioPhoneNumber}`;
      logger.debug(
        `ROUTER.handleSlackAdminCommand: Looking up ${redisHashKey} in Redis.`
      );
      const userInfo = (await RedisApiUtil.getHash(
        redisClient,
        redisHashKey
      )) as UserInfo;

      // This catches invalid userPhoneNumber:twilioPhoneNumber pairs.
      if (!userInfo) {
        logger.debug(
          'Router.handleSlackAdminCommand: No Redis data found for userId:twilioPhoneNumber pair.'
        );
        await SlackApiUtil.sendMessage(
          `*Operator:* No record found for user ID (${adminCommandArgs.userId}) and/or Twilio phone number (${adminCommandArgs.twilioPhoneNumber}).`,
          {
            channel: process.env.ADMIN_CONTROL_ROOM_SLACK_CHANNEL_ID!,
            parentMessageTs: reqBody.event.ts,
          }
        );
        // userPhoneNumber:twilioPhoneNumber pair found successfully.
      } else {
        // Voter already in destination slack channel (error).
        if (
          userInfo.activeChannelName ===
          adminCommandArgs.destinationSlackChannelName
        ) {
          logger.debug(
            'Router.handleSlackAdminCommand: Voter is already active in destination Slack channel.'
          );
          await SlackApiUtil.sendMessage(
            `*Operator:* Voter's thread in ${userInfo.activeChannelName} is already the active thread.`,
            {
              channel: process.env.ADMIN_CONTROL_ROOM_SLACK_CHANNEL_ID!,
              parentMessageTs: reqBody.event.ts,
            }
          );
        } else {
          const adminCommandParams = {
            commandParentMessageTs: reqBody.event.ts,
            previousSlackChannelName: userInfo.activeChannelName,
            routingSlackUserName: originatingSlackUserName,
          };
          logger.debug(
            `Router.handleSlackAdminCommand: Routing voter from ${userInfo.activeChannelName} to ${adminCommandArgs.destinationSlackChannelName}.`
          );
          await routeVoterToSlackChannel(
            userInfo,
            redisClient,
            adminCommandArgs,
            adminCommandParams
          );
        }
      }
      return;
    }
    case CommandUtil.FIND_VOTER:
      await CommandUtil.findVoter(
        redisClient,
        adminCommandArgs.voterIdentifier
      );
      return;
    case CommandUtil.RESET_VOTER:
      await CommandUtil.resetVoter(
        redisClient,
        adminCommandArgs.userId,
        adminCommandArgs.twilioPhoneNumber
      );
      return;
    default:
      logger.info(
        `ROUTER.handleSlackAdminCommand: Unknown Slack admin command`
      );
      return;
  }
}
