import axios from 'axios';
import Hashes from 'jshashes';
import * as Sentry from '@sentry/node';
import * as DbApiUtil from './db_api_util';
import logger from './logger';
import { UserInfo } from './types';
import { SlackBlock, SlackView } from './slack_block_util';
import * as RedisApiUtil from './redis_api_util';
import { PromisifiedRedisClient } from './redis_client';

type SlackSendMessageResponse = {
  data: {
    channel: string;
    ts: string;
  };
};

type SlackSendMessageOptions = {
  channel: string;
  parentMessageTs?: string;
  blocks?: SlackBlock[];
};

type SlackChannelNamesAndIds = {
  [channelId: string]: string; // mapping of channel ID to channel name
};

export async function sendMessage(
  message: string,
  options: SlackSendMessageOptions
): Promise<null | SlackSendMessageResponse>;
export async function sendMessage(
  message: string,
  options: SlackSendMessageOptions,
  databaseMessageEntry: DbApiUtil.DatabaseMessageEntry,
  userInfo: UserInfo
): Promise<null | SlackSendMessageResponse>;
export async function sendMessage(
  message: string,
  options: SlackSendMessageOptions,
  databaseMessageEntry: DbApiUtil.DatabaseMessageEntry | null = null,
  userInfo: UserInfo | null = null
): Promise<null | SlackSendMessageResponse> {
  logger.info(`ENTERING SLACKAPIUTIL.sendMessage`);
  if (databaseMessageEntry) {
    logger.info(
      `SLACKAPIUTIL.sendMessage: This Slack message send will log to DB (databaseMessageEntry is not null).`
    );
    // Copies a few fields from userInfo to databaseMessageEntry.
    DbApiUtil.updateDbMessageEntryWithUserInfo(userInfo!, databaseMessageEntry);
    databaseMessageEntry.slackChannel = options.channel;
    databaseMessageEntry.slackParentMessageTs = options.parentMessageTs;
    databaseMessageEntry.slackSendTimestamp = new Date();
  }

  try {
    const response = await axios.post(
      'https://slack.com/api/chat.postMessage',
      {
        'Content-Type': 'application/json',
        channel: options.channel,
        text: message,
        token: process.env.SLACK_BOT_ACCESS_TOKEN,
        thread_ts: options.parentMessageTs,
        blocks: options.blocks,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.SLACK_BOT_ACCESS_TOKEN}`,
        },
      }
    );

    if (!response.data.ok) {
      logger.error(
        `SLACKAPIUTIL.sendMessage: ERROR in sending Slack message: ${response.data.error}`
      );
      return null;
    }

    logger.info(`SLACKAPIUTIL.sendMessage: Successfully sent Slack message,
                  response.data.message.ts: ${response.data.message.ts},
                  message: ${message},
                  channel: ${options.channel},
                  thread_ts: ${options.parentMessageTs}\n`);

    if (databaseMessageEntry) {
      databaseMessageEntry.successfullySent = true;
      databaseMessageEntry.slackMessageTs = response.data.message.ts;

      try {
        await DbApiUtil.logMessageToDb(databaseMessageEntry);
      } catch (error) {
        logger.info(
          `SLACKAPIUTIL.sendMessage: failed to log message send success to DB`
        );
        Sentry.captureException(error);
      }
    }

    return response;
  } catch (error) {
    logger.error(`SLACKAPIUTIL.sendMessage: ERROR in sending Slack message,
                  message: ${message},
                  channel: ${options.channel},
                  thread_ts: ${options.parentMessageTs}`);
    logger.error(
      `SLACKAPIUTIL.sendMessage: ERROR in sending Slack message. Error data from Slack: ${error}`
    );
    Sentry.captureException(error);
    if (databaseMessageEntry) {
      databaseMessageEntry.successfullySent = false;
      databaseMessageEntry.slackError = error.error;

      try {
        await DbApiUtil.logMessageToDb(databaseMessageEntry);
      } catch (error) {
        logger.info(
          `SLACKAPIUTIL.sendMessage: failed to log message send failure to DB`
        );
        Sentry.captureException(error);
      }
    }

    throw error;
  }
}

export async function sendMessages(
  messages: string[],
  options: SlackSendMessageOptions
): Promise<void> {
  const parentMessageTs = options.parentMessageTs;
  const channel = options.channel;

  for (const message of messages) {
    await sendMessage(message, { parentMessageTs, channel });
  }
}

export function authenticateConnectionToSlack(token: string): boolean {
  const MD5 = new Hashes.MD5();
  if (MD5.hex(token) == process.env.SLACK_AUTH_TOKEN_HASH) {
    logger.info('token verified');
    return true;
  } else {
    logger.info('token unauthorized');
    return false;
  }
}

export function copyUserInfoToDbMessageEntry(
  userInfo: UserInfo,
  dbMessageEntry: DbApiUtil.DatabaseMessageEntry
): void {
  dbMessageEntry.confirmedDisclaimer = userInfo.confirmedDisclaimer;
  dbMessageEntry.isDemo = userInfo.isDemo;
  dbMessageEntry.lastVoterMessageSecsFromEpoch =
    userInfo.lastVoterMessageSecsFromEpoch;
}

export async function fetchSlackChannelName(
  channelId: string
): Promise<string | null> {
  const response = await axios.get('https://slack.com/api/conversations.info', {
    params: {
      'Content-Type': 'application/json',
      channel: channelId,
      token: process.env.SLACK_BOT_ACCESS_TOKEN,
    },
  });

  if (response.data.ok) {
    if (process.env.NODE_ENV !== 'test')
      logger.info(
        `SLACKAPIUTIL.fetchSlackChannelName: Successfully revealed Slack channel name (${channelId} -> ${response.data.channel.name})`
      );
    return response.data.channel.name;
  } else {
    if (process.env.NODE_ENV !== 'test')
      logger.error(
        `SLACKAPIUTIL.fetchSlackChannelName: Failed to reveal Slack channel name (${channelId}). Error: ${response.data.error}.`
      );
    return null;
  }
}

export async function fetchSlackUserName(
  userId: string
): Promise<string | null> {
  const response = await axios.get('https://slack.com/api/users.info', {
    params: {
      'Content-Type': 'application/json',
      user: userId,
      token: process.env.SLACK_BOT_ACCESS_TOKEN,
    },
  });

  if (response.data.ok) {
    if (process.env.NODE_ENV !== 'test')
      logger.info(
        `SLACKAPIUTIL.fetchSlackUserName: Successfully revealed Slack user name (${userId} -> ${response.data.user.real_name})`
      );
    return response.data.user.real_name;
  } else {
    if (process.env.NODE_ENV !== 'test')
      logger.error(
        `SLACKAPIUTIL.fetchSlackUserName: Failed to reveal Slack user name (${userId}). Error: ${response.data.error}.`
      );
    return null;
  }
}

// See reference here: https://api.slack.com/messaging/retrieving#individual_messages
export async function fetchSlackMessageBlocks(
  channelId: string,
  messageTs: string
): Promise<SlackBlock[] | null> {
  const response = await axios.get(
    'https://slack.com/api/conversations.history',
    {
      params: {
        'Content-Type': 'application/json',
        token: process.env.SLACK_BOT_ACCESS_TOKEN,
        channel: channelId,
        latest: messageTs,
        inclusive: true,
      },
    }
  );

  if (response.data.ok) {
    if (process.env.NODE_ENV !== 'test')
      logger.info(
        `SLACKAPIUTIL.fetchSlackMessageFirstBlockText: Successfully revealed Slack message text (${messageTs} -> ${response.data.messages[0].blocks[0].text.text})`
      );
    return response.data.messages[0].blocks;
  } else {
    if (process.env.NODE_ENV !== 'test')
      logger.error(
        `SLACKAPIUTIL.fetchSlackMessageFirstBlockText: Failed to reveal Slack message text (${messageTs}). Error: ${response.data.error}.`
      );
    return null;
  }
}

export async function fetchSlackChannelNamesAndIds(): Promise<SlackChannelNamesAndIds | null> {
  logger.info(`ENTERING SLACKAPIUTIL.fetchSlackChannelNamesAndIds`);
  const response = await axios.get('https://slack.com/api/conversations.list', {
    params: {
      'Content-Type': 'application/json',
      token: process.env.SLACK_BOT_ACCESS_TOKEN,
      types: 'private_channel',
    },
  });

  if (response.data.ok) {
    if (process.env.NODE_ENV !== 'test')
      logger.info(
        `SLACKAPIUTIL.fetchSlackChannelNamesAndIds: Successfully fetched Slack channel names and IDs.`
      );
    const slackChannelNamesAndIds = {} as SlackChannelNamesAndIds;
    for (const idx in response.data.channels) {
      const channel = response.data.channels[idx];
      slackChannelNamesAndIds[channel.name] = channel.id;
    }
    return slackChannelNamesAndIds;
    // return response.data.messages[0].blocks;
  } else {
    if (process.env.NODE_ENV !== 'test')
      logger.error(
        `SLACKAPIUTIL.fetchSlackChannelNamesAndIds: ERROR fetching Slack channel names and IDs. Error: ${response.data.error}.`
      );
    return null;
  }
}

export async function updateSlackChannelNamesAndIdsInRedis(
  redisClient: PromisifiedRedisClient
): Promise<void> {
  logger.info(`ENTERING SLACKAPIUTIL.updateSlackChannelNamesAndIdsInRedis`);
  const slackChannelNamesAndIds = await fetchSlackChannelNamesAndIds();

  if (slackChannelNamesAndIds) {
    await RedisApiUtil.setHash(
      redisClient,
      'slackPodChannelIds',
      slackChannelNamesAndIds
    );
  }
}

export async function renderModal(
  triggerId: string,
  view: SlackView
): Promise<void> {
  logger.info(`ENTERING SLACKAPIUTIL.renderModal`);
  const response = await axios.post(
    'https://slack.com/api/views.open',
    {
      'Content-Type': 'application/json',
      trigger_id: triggerId,
      view,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_ACCESS_TOKEN}`,
      },
    }
  );

  if (response.data.ok) {
    if (process.env.NODE_ENV !== 'test')
      logger.info(
        `SLACKAPIUTIL.renderModal: Successfully rendered modal (callback_id: ${view.callback_id}).`
      );
    return;
  } else {
    if (process.env.NODE_ENV !== 'test')
      logger.error(
        `SLACKAPIUTIL.renderModal: Failed to render modal (callback_id: ${view.callback_id}). Error: ${response.data.error}.`
      );
    throw new Error(
      `SLACKAPIUTIL.renderModal: Failed to render modal (callback_id: ${view.callback_id}). Error: ${response.data.error}.`
    );
  }
}
