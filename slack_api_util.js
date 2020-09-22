const axios = require('axios');
const Hashes = require('jshashes') // v1.0.5
const Promise = require('bluebird');
const DbApiUtil = require('./db_api_util');
const SlackApiUtil = require('./slack_api_util');

const sendMessage = (message, options, databaseMessageEntry = null, userInfo = null) => {
  console.log(`\nENTERING SLACKAPIUTIL.sendMessage`);
  if (databaseMessageEntry) {
    console.log(`SLACKAPIUTIL.sendMessage: This Slack message send will log to DB (databaseMessageEntry is not null).`);
    // Copies a few fields from userInfo to databaseMessageEntry.
    DbApiUtil.updateDbMessageEntryWithUserInfo(userInfo, databaseMessageEntry);
    databaseMessageEntry.slackChannel = options.channel;
    databaseMessageEntry.slackParentMessageTs = options.parentMessageTs;
    databaseMessageEntry.slackSendTimestamp = new Date();
  }

  return axios.post('https://slack.com/api/chat.postMessage', {
    'Content-Type': 'application/json',
    'channel': options.channel,
    'text': message,
    'token': process.env.SLACK_BOT_ACCESS_TOKEN,
    'thread_ts': options.parentMessageTs,
    'blocks': options.blocks,
  },
  {
    'headers': {
      "Authorization": `Bearer ${process.env.SLACK_BOT_ACCESS_TOKEN}`,
    },
  }).then(response => {
    if (!response.data.ok) {
      console.log('\x1b[41m%s\x1b[1m\x1b[0m', `SLACKAPIUTIL.sendMessage: ERROR in sending Slack message: ${response.data.error}`);
      return;
    }
    console.log(`SLACKAPIUTIL.sendMessage: Successfully sent Slack message,
                  response.data.message.ts: ${response.data.message.ts},
                  message: ${message},
                  channel: ${options.channel},
                  thread_ts: ${options.parentMessageTs}\n`);
    if (databaseMessageEntry) {
      databaseMessageEntry.successfullySent = true;
      databaseMessageEntry.slackMessageTs = response.data.message.ts;
      DbApiUtil.logMessageToDb(databaseMessageEntry);
    }
    return response;
  }).catch(error => {
    console.log('\x1b[41m%s\x1b[1m\x1b[0m', `SLACKAPIUTIL.sendMessage: ERROR in sending Slack message,
                  message: ${message},
                  channel: ${options.channel},
                  thread_ts: ${options.parentMessageTs}`);
    console.log('\x1b[41m%s\x1b[1m\x1b[0m', `SLACKAPIUTIL.sendMessage: ERROR in sending Slack message. Error data from Slack: ${error}`);
    if (databaseMessageEntry) {
      databaseMessageEntry.successfullySent = false;
      databaseMessageEntry.slackError = error.error;
      DbApiUtil.logMessageToDb(databaseMessageEntry);
    }
    return error;
  });
};

exports.sendMessage = sendMessage;

exports.sendMessages = (messages, options) => {
  const parentMessageTs = options.parentMessageTs;
  const channel = options.channel;

  const messagePromises = messages.map(message => Promise.resolve(message));

  return Promise.mapSeries(messagePromises, (message, index, arrayLength) => {
    return SlackApiUtil.sendMessage(message, {parentMessageTs, channel});
  });
};

exports.authenticateConnectionToSlack = (token) => {
  const MD5 = new Hashes.MD5;
  if(MD5.hex(token) == process.env.SLACK_AUTH_TOKEN_HASH){
    console.log("token verified");
    return true;
  } else {
    console.log("token unauthorized");
    return false;
  }
};

exports.sendBackChallenge = (req) => {
  res.status(200).json({ challenge: req.body.challenge });
};

exports.copyUserInfoToDbMessageEntry = (userInfo, dbMessageEntry) => {
  dbMessageEntry.confirmedDisclaimer = userInfo.confirmedDisclaimer;
  dbMessageEntry.isDemo = userInfo.isDemo;
  dbMessageEntry.confirmedDisclaimer = userInfo.lastVoterMessageSecsFromEpoch;
};

exports.fetchSlackChannelName = (channelId) => {
  return axios.get('https://slack.com/api/conversations.info', {
    params: {
      'Content-Type': 'application/json',
      'channel': channelId,
      'token': process.env.SLACK_BOT_ACCESS_TOKEN,
    }
  }).then(response => {
    if (response.data.ok) {
      if (process.env.NODE_ENV !== "test") console.log(`SLACKAPIUTIL.fetchSlackChannelName: Successfully revealed Slack channel name (${channelId} -> ${response.data.channel.name})`);
      return response.data.channel.name;
    } else {
      if (process.env.NODE_ENV !== "test") console.log('\x1b[41m%s\x1b[1m\x1b[0m', `SLACKAPIUTIL.fetchSlackChannelName: Failed to reveal Slack channel name (${channelId}). Error: ${response.data.error}.`);
      return null;
    }
  }).catch(error => {
    if (process.env.NODE_ENV !== "test") console.log('\x1b[41m%s\x1b[1m\x1b[0m', `SLACKAPIUTIL.fetchSlackChannelName: Failed to reveal Slack channel name (${channelId}). Error: ${error}.`);
    return error;
  });
};

exports.fetchSlackUserName = (userId) => {
  return axios.get('https://slack.com/api/users.info', {
    params: {
      'Content-Type': 'application/json',
      'user': userId,
      'token': process.env.SLACK_BOT_ACCESS_TOKEN,
    }
  }).then(response => {
    if (response.data.ok) {
      if (process.env.NODE_ENV !== "test") console.log(`SLACKAPIUTIL.fetchSlackUserName: Successfully revealed Slack user name (${userId} -> ${response.data.user.real_name})`);
      return response.data.user.real_name;
    } else {
      if (process.env.NODE_ENV !== "test") console.log('\x1b[41m%s\x1b[1m\x1b[0m', `SLACKAPIUTIL.fetchSlackUserName: Failed to reveal Slack user name (${userId}). Error: ${response.data.error}.`);
      return null;
    }
  }).catch(error => {
    if (process.env.NODE_ENV !== "test") console.log('\x1b[41m%s\x1b[1m\x1b[0m', `SLACKAPIUTIL.fetchSlackUserName: Failed to reveal Slack user name (${userId}). Error: ${error}.`);
    return error;
  });
};

// See reference here: https://api.slack.com/messaging/retrieving#individual_messages
exports.fetchSlackMessageBlocks = (channelId, messageTs) => {
  return axios.get('https://slack.com/api/conversations.history', {
    params: {
      'Content-Type': 'application/json',
      'token': process.env.SLACK_BOT_ACCESS_TOKEN,
      'channel': channelId,
      'latest': messageTs,
      'inclusive': true,
    }
  }).then(response => {
    if (response.data.ok) {
      if (process.env.NODE_ENV !== "test") console.log(`SLACKAPIUTIL.fetchSlackMessageFirstBlockText: Successfully revealed Slack message text (${messageTs} -> ${response.data.messages[0].blocks[0].text.text})`);
      return response.data.messages[0].blocks;
    } else {
      if (process.env.NODE_ENV !== "test") console.log('\x1b[41m%s\x1b[1m\x1b[0m', `SLACKAPIUTIL.fetchSlackMessageFirstBlockText: Failed to reveal Slack message text (${messageTs}). Error: ${response.data.error}.`);
      return null;
    }
  }).catch(error => {
    if (process.env.NODE_ENV !== "test") console.log('\x1b[41m%s\x1b[1m\x1b[0m', `SLACKAPIUTIL.fetchSlackMessageFirstBlockText: Failed to reveal Slack user name (${messageTs}). Error: ${error}.`);
    return error;
  });
};
