import axios from 'axios';
import axiosRetry from 'axios-retry';
import Hashes from 'jshashes';
import * as Sentry from '@sentry/node';
import * as DbApiUtil from './db_api_util';
import logger from './logger';
import { UserInfo } from './types';
import { SlackBlock, SlackView } from './slack_block_util';
import * as RedisApiUtil from './redis_api_util';
import { PromisifiedRedisClient } from './redis_client';
import { SlackFile } from './message_parser';

export const slackAPI = axios.create({
  baseURL: 'https://slack.com/api/',
});

slackAPI.defaults.headers.post['Content-Type'] = 'application/json';
slackAPI.defaults.headers.post[
  'Authorization'
] = `Bearer ${process.env.SLACK_BOT_ACCESS_TOKEN}`;

axiosRetry(slackAPI, {
  // This function is passed a retryCount which can be used to
  // define custom retry delays.
  retryDelay: () => 2000 /* millisecs between retries*/,
  retries: 3,
});

type SlackSendMessageResponse = {
  data: {
    channel: string;
    ts: string;
  };
};

type SlackSendMessageOptions = {
  channel: string;
  parentMessageTs?: string;
  parse?: boolean;
  blocks?: SlackBlock[];
  isVoterMessage?: boolean;
  isAutomatedMessage?: boolean;
};

type SlackChannelNamesAndIds = {
  [channelId: string]: string; // mapping of channel ID to channel name
};

export function linkToSlackChannel(
  channelId: string,
  channelName: string
): string {
  return `<slack://channel?team=${process.env.TEAM_ID}&id=${channelId}|#${channelName}>`;
}

export async function getThreadPermalink(
  channel: string,
  message_ts: string
): Promise<string> {
  try {
    // Pick the newest message in the thread
    const response = await slackAPI.get('chat.getPermalink', {
      params: {
        channel: channel,
        message_ts: message_ts,
        token: process.env.SLACK_BOT_ACCESS_TOKEN,
      },
    });
    if (!response.data.ok) {
      logger.error(
        `SLACKAPIUTIL.getThreadPermalink: ERROR: ${JSON.stringify(
          response.data
        )}`
      );
    }
    return response.data.permalink;
  } catch (error) {
    logger.error(`SLACKAPIUTIL.getThreadPermalink: ERROR in getting permalink message,
                  channel: ${channel},
                  message_ts: ${message_ts}`);
    throw error;
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
export async function makeFilesPublic(files: SlackFile[]): Promise<string[]> {
  const errors = [] as string[];
  for (const file of files) {
    // first post a permalink in a public channel so that anyone (namely,
    // the bot) can make the file public
    let response = await slackAPI.post('chat.postMessage', {
      channel: process.env.ATTACHMENTS_SLACK_CHANNEL_ID || '',
      text: file.permalink,
      token: process.env.SLACK_BOT_ACCESS_TOKEN,
      unfurl_media: true,
      unfurl_links: true,
    });
    if (!response.data.ok) {
      errors.push(`Unable to post permalink to attachments channel`);
      logger.error(
        `SLACKAPIUTIL.makeFilesPublic: unable to post permalink to channel: ${JSON.stringify(
          response.data
        )}`
      );
      continue;
    }

    await delay(2000);

    // then make it public
    response = await axios.post(
      'https://slack.com/api/files.sharedPublicURL',
      null,
      {
        params: {
          file: file.id,
          token: process.env.SLACK_USER_ACCESS_TOKEN,
        },
      }
    );
    if (!response.data.ok) {
      errors.push('Unable to make attachment public');
      logger.error(
        `SLACKAPIUTIL.makeFilesPublic: Failed with ${JSON.stringify(
          response.data
        )}`
      );
    } else {
      logger.info(
        `SLACKAPIUTIL.makeFilesPublic: successfully made ${file.id} public`
      );
    }
  }
  return errors;
}

export async function sendEphemeralResponse(
  url: string,
  message: string
): Promise<void> {
  try {
    const response = await axios.post(url, {
      text: message,
      token: process.env.SLACK_BOT_ACCESS_TOKEN,
      unfurl_media: false,
      unfurl_links: false,
      response_type: 'ephemeral',
    });
    if (response.status != 200) {
      throw new Error(
        `SLACKAPIUTIL.sendEphemeralResponse: ERROR in sending Slack message: ${JSON.stringify(
          response.data
        )}`
      );
    }
  } catch (error) {
    logger.error(
      `SLACKAPIUTIL.sendEphemeralResponse: ERROR in sending Slack response. Error data from Slack: ${JSON.stringify(
        error
      )}`
    );
    Sentry.captureException(error);
  }
}

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
    const slackArgs = {
      channel: options.channel,
      text: message,
      token: process.env.SLACK_BOT_ACCESS_TOKEN,
      thread_ts: options.parentMessageTs,
      blocks: options.blocks,
      unfurl_media: false,
      unfurl_links: false,
    } as { [key: string]: any };

    if (options.isVoterMessage) {
      slackArgs.username = `Voter ${userInfo?.userId.substring(0, 5)}`;
      slackArgs.icon_emoji = ':bust_in_silhouette:';
    } else if (options.isAutomatedMessage) {
      slackArgs.username = `Helpline (Automated)`;
      slackArgs.icon_emoji = ':gear:';
    }

    const response = await slackAPI.post('chat.postMessage', slackArgs);

    if (!response.data.ok) {
      logger.error(
        `SLACKAPIUTIL.sendMessage: ERROR in sending Slack message: ${JSON.stringify(
          response.data
        )}`
      );
      throw new Error(
        `SLACKAPIUTIL.sendMessage: ERROR in sending Slack message: ${JSON.stringify(
          response.data
        )}`
      );
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
        await DbApiUtil.updateThreadStatusFromMessage(databaseMessageEntry);
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
      `SLACKAPIUTIL.sendMessage: ERROR in sending Slack message. Error data from Slack: ${JSON.stringify(
        error
      )}`
    );
    Sentry.captureException(error);
    if (databaseMessageEntry) {
      databaseMessageEntry.successfullySent = false;
      databaseMessageEntry.slackError = error.error;

      try {
        await DbApiUtil.logMessageToDb(databaseMessageEntry);
      } catch (error) {
        logger.info(
          `SLACKAPIUTIL.sendMessage: failed to log message send failure to DB: ${JSON.stringify(
            error
          )}`
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
  const response = await slackAPI.get('conversations.info', {
    params: {
      channel: channelId,
      token: process.env.SLACK_BOT_ACCESS_TOKEN,
    },
  });

  if (response.data.ok) {
    logger.info(
      `SLACKAPIUTIL.fetchSlackChannelName: Successfully revealed Slack channel name (${channelId} -> ${response.data.channel.name})`
    );
    return response.data.channel.name;
  } else {
    logger.error(
      `SLACKAPIUTIL.fetchSlackChannelName: Failed to reveal Slack channel name (${channelId}). Error: ${JSON.stringify(
        response.data
      )}.`
    );
    return null;
  }
}

export async function fetchSlackUserName(
  userId: string
): Promise<string | null> {
  const response = await slackAPI.get('users.info', {
    params: {
      user: userId,
      token: process.env.SLACK_BOT_ACCESS_TOKEN,
    },
  });

  if (response.data.ok) {
    logger.info(
      `SLACKAPIUTIL.fetchSlackUserName: Successfully revealed Slack user name (${userId} -> ${response.data.user.real_name})`
    );
    return response.data.user.real_name;
  } else {
    logger.error(
      `SLACKAPIUTIL.fetchSlackUserName: Failed to reveal Slack user name (${userId}). Error: response.data: ${JSON.stringify(
        response.data
      )}`
    );
    return null;
  }
}

// See reference here: https://api.slack.com/messaging/retrieving#individual_messages
export async function fetchSlackMessageBlocks(
  channelId: string,
  messageTs: string
): Promise<SlackBlock[] | null> {
  const response = await slackAPI.get('conversations.history', {
    params: {
      token: process.env.SLACK_BOT_ACCESS_TOKEN,
      channel: channelId,
      latest: messageTs,
      inclusive: true,
    },
  });

  if (response.data.ok) {
    logger.info(
      `SLACKAPIUTIL.fetchSlackMessageFirstBlockText: Successfully revealed Slack message text (${messageTs} -> ${response.data.messages[0].blocks[0].text.text})`
    );
    return response.data.messages[0].blocks;
  } else {
    logger.error(
      `SLACKAPIUTIL.fetchSlackMessageFirstBlockText: Failed to reveal Slack message text (${messageTs}). Error: ${response.data.error}.`
    );
    return null;
  }
}

export async function fetchSlackChannelNamesAndIds(): Promise<SlackChannelNamesAndIds | null> {
  logger.info(`ENTERING SLACKAPIUTIL.fetchSlackChannelNamesAndIds`);
  const firstPageResponse = await slackAPI.get('conversations.list', {
    params: {
      token: process.env.SLACK_BOT_ACCESS_TOKEN,
      types: 'private_channel',
    },
  });

  if (!firstPageResponse.data.ok) {
    logger.error(
      `SLACKAPIUTIL.fetchSlackChannelNamesAndIds: ERROR fetching initial page of Slack channel names and IDs. Error: response.data: ${JSON.stringify(
        firstPageResponse.data
      )}`
    );
    return null;
  }
  logger.info(
    `SLACKAPIUTIL.fetchSlackChannelNamesAndIds: Successfully fetched first page of Slack channel names and IDs.`
  );

  let channels = firstPageResponse.data.channels;
  let cursor = firstPageResponse.data.response_metadata.next_cursor;
  // Slack will return a (falsy) empty string when there is no next page.
  // See 'Pagination' on this reference: https://api.slack.com/methods/conversations.list
  while (cursor) {
    logger.info(
      `SLACKAPIUTIL.fetchSlackChannelNamesAndIds: Fetching subsequent page of Slack channel names and IDs (cursor: ${cursor}).`
    );
    const subsequentPageResponse = await slackAPI.get('conversations.list', {
      params: {
        token: process.env.SLACK_BOT_ACCESS_TOKEN,
        types: 'private_channel',
        cursor,
      },
    });

    if (subsequentPageResponse.data.ok) {
      logger.info(
        `SLACKAPIUTIL.fetchSlackChannelNamesAndIds: Successfully fetched subsequent page of Slack channel names and IDs (cursor: ${cursor}).`
      );
      cursor = subsequentPageResponse.data.response_metadata.next_cursor;
      channels = channels.concat(subsequentPageResponse.data.channels);
    } else {
      logger.error(
        `SLACKAPIUTIL.fetchSlackChannelNamesAndIds: ERROR fetching subsequent page of Slack channel names and IDs. Error: response.data: ${JSON.stringify(
          firstPageResponse.data
        )}`
      );
      break;
    }
  }

  const slackChannelNamesAndIds = {} as SlackChannelNamesAndIds;
  for (const idx in channels) {
    const channel = channels[idx];
    slackChannelNamesAndIds[channel.name] = channel.id;
  }
  return slackChannelNamesAndIds;
}

export async function updateSlackChannelNamesAndIdsInRedis(
  redisClient: PromisifiedRedisClient
): Promise<SlackChannelNamesAndIds | null> {
  logger.info(`ENTERING SLACKAPIUTIL.updateSlackChannelNamesAndIdsInRedis`);
  const slackChannelNamesAndIds = await fetchSlackChannelNamesAndIds();

  if (slackChannelNamesAndIds) {
    await RedisApiUtil.setHash(
      redisClient,
      'slackPodChannelIds',
      slackChannelNamesAndIds
    );
  }

  return slackChannelNamesAndIds;
}

// Get Slack Channel Name / ID map, populating cache if needed
export async function getSlackChannelNamesAndIds(
  redisClient: PromisifiedRedisClient
): Promise<SlackChannelNamesAndIds | null> {
  const slackChannelIds = await RedisApiUtil.getHash(
    redisClient,
    'slackPodChannelIds'
  );
  if (slackChannelIds) return slackChannelIds;
  return updateSlackChannelNamesAndIdsInRedis(redisClient);
}

export async function addSlackMessageReaction(
  messageChannel: string,
  messageTs: string,
  reaction: string
): Promise<void> {
  const response = await slackAPI.post('reactions.add', {
    channel: messageChannel,
    timestamp: messageTs,
    name: reaction,
  });

  if (!response.data.ok) {
    throw new Error(
      `SLACKAPIUTIL.addSlackMessageReaction: ERROR in adding reaction: ${response.data.error}`
    );
  }
}

export async function isMemberOfAdminChannel(
  slackUserId: string
): Promise<boolean> {
  const channelId = process.env.ADMIN_CONTROL_ROOM_SLACK_CHANNEL_ID;

  // TODO: Consider caching this data. For now, calling every time is the best
  // way to maintain security though.
  const response = await slackAPI.get('conversations.members', {
    params: {
      channel: channelId,
      token: process.env.SLACK_BOT_ACCESS_TOKEN,
    },
  });

  if (response.data.ok) {
    logger.info(
      `SLACKAPIUTIL.isMemberOfAdminChannel: Successfully called isMemberOfAdminChannel`
    );
    return response.data.members.includes(slackUserId);
  } else {
    logger.error(
      `SLACKAPIUTIL.isMemberOfAdminChannel: Failed to call conversations.members for ${channelId}. Error: response.data: ${JSON.stringify(
        response.data
      )}`
    );
    return false;
  }
}

/**
 * Renders a modal in slack and returns the modal ID
 */
export async function renderModal(
  triggerId: string,
  view: SlackView
): Promise<string> {
  logger.info(`ENTERING SLACKAPIUTIL.renderModal`);
  const response = await slackAPI.post('views.open', {
    trigger_id: triggerId,
    view,
  });

  if (response.data.ok) {
    logger.info(
      `SLACKAPIUTIL.renderModal: Successfully rendered modal (callback_id: ${view.callback_id}).`
    );
    return response.data.view.id;
  } else {
    logger.error(
      `SLACKAPIUTIL.renderModal: Failed to render modal (callback_id: ${
        view.callback_id
      }). Error: response.data: ${JSON.stringify(response.data)}`
    );
    throw new Error(
      `SLACKAPIUTIL.renderModal: Failed to render modal (callback_id: ${
        view.callback_id
      }). Error: response.data: ${JSON.stringify(response.data)}`
    );
  }
}

/**
 * Updates a modal in slack given the modal ID from renderModal
 */
export async function updateModal(
  viewId: string,
  view: SlackView
): Promise<string> {
  logger.info(`ENTERING SLACKAPIUTIL.updateModal`);
  const response = await slackAPI.post('views.update', {
    view_id: viewId,
    view,
  });

  if (response.data.ok) {
    logger.info(
      `SLACKAPIUTIL.updateModal: Successfully updated modal (callback_id: ${view.callback_id}).`
    );
    return response.data.view.id;
  } else {
    logger.error(
      `SLACKAPIUTIL.updateModal: Failed to update modal (callback_id: ${
        view.callback_id
      }). response.data: ${JSON.stringify(response.data)}`
    );
    throw new Error(
      `SLACKAPIUTIL.updateModal: Failed to update modal (callback_id: ${
        view.callback_id
      }). response.data: ${JSON.stringify(response.data)}`
    );
  }
}
