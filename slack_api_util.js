const axios = require('axios');
const Hashes = require('jshashes') // v1.0.5
const Promise = require('bluebird');
const DbApiUtil = require('./db_api_util');
const SlackApiUtil = require('./slack_api_util');

const sendMessage = (message, options, databaseMessageEntry = null, userInfo = null) => {
  if (databaseMessageEntry) {
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
  },
  {
    'headers': {
      "Authorization": `Bearer ${process.env.SLACK_BOT_ACCESS_TOKEN}`,
    },
  }).then(response => {
    if (process.env.NODE_ENV !== "test") console.log(`\n\nSuccessfully sent message to Slack: ${message}`);
    if (databaseMessageEntry) {
      databaseMessageEntry.successfullySent = true;
      databaseMessageEntry.slackMessageTs = response.data.message.ts;
      DbApiUtil.logMessageToDb(databaseMessageEntry);
    }
    return response;
  }).catch(error => {
    console.log(error);
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
      if (process.env.NODE_ENV !== "test") console.log(`SlackApiUtil: Successfully revealed Slack channel name (${channelId} -> ${response.data.channel.name})`);
      return response.data.channel.name;
    } else {
      if (process.env.NODE_ENV !== "test") console.log(`SlackApiUtil: Failed to reveal Slack channel name (${channelId}). Error: ${response.data.error}.`);
      return null;
    }
  }).catch(error => {
    if (process.env.NODE_ENV !== "test") console.log(`SlackApiUtil: Failed to reveal Slack channel name (${channelId}). Error: ${error}.`);
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
      if (process.env.NODE_ENV !== "test") console.log(`SlackApiUtil: Successfully revealed Slack user name (${userId} -> ${response.data.user.real_name})`);
      return response.data.user.real_name;
    } else {
      if (process.env.NODE_ENV !== "test") console.log(`SlackApiUtil: Failed to reveal Slack user name (${userId}). Error: ${response.data.error}.`);
      return null;
    }
  }).catch(error => {
    if (process.env.NODE_ENV !== "test") console.log(`SlackApiUtil: Failed to reveal Slack user name (${userId}). Error: ${error}.`);
    return error;
  });
};
