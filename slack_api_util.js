const axios = require('axios');
const Hashes = require('jshashes'); // v1.0.5
const Sentry = require('@sentry/node');
const DbApiUtil = require('./db_api_util');
const SlackApiUtil = require('./slack_api_util');
const logger = require('./logger');

const sendMessage = async (
  message,
  options,
  databaseMessageEntry = null,
  userInfo = null
) => {
  logger.info(`ENTERING SLACKAPIUTIL.sendMessage`);
  if (databaseMessageEntry) {
    logger.info(
      `SLACKAPIUTIL.sendMessage: This Slack message send will log to DB (databaseMessageEntry is not null).`
    );
    // Copies a few fields from userInfo to databaseMessageEntry.
    DbApiUtil.updateDbMessageEntryWithUserInfo(userInfo, databaseMessageEntry);
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
      return;
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
};

exports.sendMessage = sendMessage;

exports.sendMessages = async (messages, options) => {
  const parentMessageTs = options.parentMessageTs;
  const channel = options.channel;

  for (const message of messages) {
    await SlackApiUtil.sendMessage(message, { parentMessageTs, channel });
  }
};

exports.authenticateConnectionToSlack = (token) => {
  const MD5 = new Hashes.MD5();
  if (MD5.hex(token) == process.env.SLACK_AUTH_TOKEN_HASH) {
    logger.info('token verified');
    return true;
  } else {
    logger.info('token unauthorized');
    return false;
  }
};

exports.copyUserInfoToDbMessageEntry = (userInfo, dbMessageEntry) => {
  dbMessageEntry.confirmedDisclaimer = userInfo.confirmedDisclaimer;
  dbMessageEntry.isDemo = userInfo.isDemo;
  dbMessageEntry.confirmedDisclaimer = userInfo.lastVoterMessageSecsFromEpoch;
};

exports.fetchSlackChannelName = async (channelId) => {
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
};

exports.fetchSlackUserName = async (userId) => {
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
};

// See reference here: https://api.slack.com/messaging/retrieving#individual_messages
exports.fetchSlackMessageBlocks = async (channelId, messageTs) => {
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
};
