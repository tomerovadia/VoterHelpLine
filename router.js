if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
  require('dotenv').config();
}

const MessageConstants = require('./message_constants');
const SlackApiUtil = require('./slack_api_util');
const TwilioApiUtil = require('./twilio_api_util');
const StateParser = require('./state_parser');
const DbApiUtil = require('./db_api_util');
const RedisApiUtil = require('./redis_api_util');
const LoadBalancer = require('./load_balancer');
const Hashes = require('jshashes'); // v1.0.5
const SlackMessageFormatter = require('./slack_message_formatter');
const AdminUtil = require('./admin_util');
const MessageParser = require('./message_parser');

const MINS_BEFORE_WELCOME_BACK_MESSAGE = 60;

exports.handleNewVoter = (userOptions, redisClient, twilioPhoneNumber, inboundDbMessageEntry) => {
  const userPhoneNumber = userOptions.userPhoneNumber;
  const userMessage = userOptions.userMessage;

  const userInfo = {};

  const MD5 = new Hashes.MD5;
  userInfo.userId = MD5.hex(userPhoneNumber);
  // Used in admin controls, so admins can specify only user id.
  userInfo.userPhoneNumber = userPhoneNumber;
  userInfo.isDemo = false;
  if (twilioPhoneNumber == process.env.DEMO_PHONE_NUMBER ||
      twilioPhoneNumber == process.env.PREVIOUS_DEMO_PHONE_NUMBER ||
      userPhoneNumber == process.env.TESTER_PHONE_NUMBER) {
    userInfo.isDemo = true;
  }
  userInfo.confirmedDisclaimer = false;
  userInfo.volunteerEngaged = false;

  const welcomeMessage = MessageConstants.WELCOME_AND_DISCLAIMER;
  let lobbyChannel = "lobby";
  const operatorMessage = `<!channel> New voter!\n*User ID:* ${userInfo.userId}\n*Connected via:* ${twilioPhoneNumber}`;

  if (userInfo.isDemo) {
    lobbyChannel = "demo-lobby";
  }

  userInfo.lastVoterMessageSecsFromEpoch = Math.round(Date.now() / 1000);

  // Welcome the voter
  TwilioApiUtil.sendMessage(welcomeMessage, {userPhoneNumber, twilioPhoneNumber},
      DbApiUtil.populateAutomatedDbMessageEntry(userInfo)
    );

  // In Slack, create entry channel message, followed by voter's message and intro text.
  SlackApiUtil.sendMessage(operatorMessage,
  {
    channel: lobbyChannel,
  }).then(response => {
    // Remember the lobby thread for this user and this channel,
    // using the ID version of the channel.
    userInfo[response.data.channel] = response.data.ts;

    // Set active channel to the lobby, since the voter is new.
    // Makes sure subsequent messages from the voter go to the lobby, until this
    // active channel is changed.
    userInfo.activeChannelId = response.data.channel;
    userInfo.activeChannelName = lobbyChannel;

    // Pass the voter's message along to the Slack lobby thread,
    // and show in the Slack lobby thread the welcome message the voter received
    // in response.
    SlackApiUtil.sendMessage(`*${userInfo.userId.substring(0,5)}:* ${userMessage}`,
      {parentMessageTs: response.data.ts, channel: response.data.channel}, inboundDbMessageEntry, userInfo).then(() => {
        SlackApiUtil.sendMessage(`*Automated Message:* ${welcomeMessage}`,
          {parentMessageTs: response.data.ts, channel: response.data.channel});
      });

    // Add key/value such that given a user phone number we can get the
    // Slack lobby thread associated with that user.
    RedisApiUtil.setHash(redisClient, `${userInfo.userId}:${twilioPhoneNumber}`, userInfo);

    // Add key/value such that given Slack thread data we can get a
    // user phone number.
    RedisApiUtil.setHash(redisClient, `${response.data.channel}:${response.data.ts}`,
                        {userPhoneNumber, twilioPhoneNumber});
  });
};

// This helper handles all tasks associated with routing a voter to a new
// channel that require the new channel's thread.
const routeVoterToSlackChannelHelper = (userInfo, redisClient, twilioPhoneNumber,
                                  {destinationSlackChannelName, destinationSlackChannelId, destinationSlackParentMessageTs},
                                  timestampOfLastMessageInThread) => {
  const userPhoneNumber = userInfo.userPhoneNumber;

  let messageHistoryContextText = "Below are our messages with the voter since they left this thread.";
  // If voter is returning to a channel/thread, a timestamp should be passed, used
  // to only retrieve messages since the voter left that thread.
  if (!timestampOfLastMessageInThread) {
    // If timestamp isn't passed, voter is new to channel. Retrieve full message history.
    timestampOfLastMessageInThread = "1990-01-01 10:00:00.000";
    messageHistoryContextText = "Below is the voter's message history so far.";
  }

  // Reassign the active channel so that the next voter messages go to the
  // new active channel.
  userInfo.activeChannelId = destinationSlackChannelId;
  userInfo.activeChannelName = destinationSlackChannelName;

  // Update userInfo in Redis (remember state channel thread identifying info and new activeChannel).
  RedisApiUtil.setHash(redisClient, `${userInfo.userId}:${twilioPhoneNumber}`, userInfo);

  // Populate state channel thread with message history so far.
  return DbApiUtil.getMessageHistoryFor(userInfo.userId, timestampOfLastMessageInThread).then(messageHistory => {
    // Just in case.
    if (!messageHistory) {
      if (process.env.NODE_ENV !== "test") console.log("Router.routeVoterToSlackChannelHelper: No message history found.");
      return;
    }
    const formattedMessageHistory = SlackMessageFormatter.formatMessageHistory(messageHistory, userInfo.userId.substring(0,5));

    return SlackApiUtil.sendMessage(`*Operator:* ${messageHistoryContextText}\n\n${formattedMessageHistory}`,
                                      {parentMessageTs: destinationSlackParentMessageTs, channel: destinationSlackChannelId});
  });
};

// This function routes a voter to a new channel WHETHER OR NOT they have
// previously been to that channel before, creating a new thread if needed.
const routeVoterToSlackChannel = (userInfo, redisClient, {userId, twilioPhoneNumber, destinationSlackChannelName}, adminCommandParams /* only for admin re-routes (not automated)*/) => {
  const userPhoneNumber = userInfo.userPhoneNumber;

  return RedisApiUtil.getHash(redisClient, "slackPodChannelIds").then(slackChannelIds => {
    const destinationSlackChannelId = slackChannelIds[destinationSlackChannelName];

    // Operations for successful ADMIN route of voter.
    if (adminCommandParams) {
      // Error catching for admin command: destination channel not found.
      if (!destinationSlackChannelId) {
        if (process.env.NODE_ENV !== "test") console.log("Router.routeVoterToSlackChannel: destinationSlackChannelName not found.");
        return SlackApiUtil.sendMessage(`*Operator:* Slack channel #${destinationSlackChannelName} not found.`,
                                        {channel: process.env.ADMIN_CONTROL_ROOM_SLACK_CHANNEL_ID, parentMessageTs: adminCommandParams.commandParentMessageTs});
      }
      // TODO: This should probably be a lot later in the routing of the voter.
      SlackApiUtil.sendMessage(`*Operator:* Operation successful.`,
                                      {channel: process.env.ADMIN_CONTROL_ROOM_SLACK_CHANNEL_ID, parentMessageTs: adminCommandParams.commandParentMessageTs});
      SlackApiUtil.sendMessage(`*Operator:* Voter is being routed to #${destinationSlackChannelName} by ${adminCommandParams.routingSlackUserName}.`,
                                  {channel: userInfo.activeChannelId, parentMessageTs: userInfo[userInfo.activeChannelId]});
    // Operations for AUTOMATED route of voter.
    } else {
      SlackApiUtil.sendMessage(`*Operator:* Routing voter to #${destinationSlackChannelName}.`,
                                  {channel: userInfo.activeChannelId, parentMessageTs: userInfo[userInfo.activeChannelId]});
    }

    // If this user hasn't been to the destination channel, create new thread in the channel.
    if (!userInfo[destinationSlackChannelId]) {
      let parentMessageText = `<!channel> New ${userInfo.stateName} voter!\n*User ID:* ${userId}\n*Connected via:* ${twilioPhoneNumber}`;
      if (adminCommandParams) {
        parentMessageText = `<!channel> Voter routed from #${adminCommandParams.previousSlackChannelName} by ${adminCommandParams.routingSlackUserName}\n*User ID:* ${userId}\n*Connected via:* ${twilioPhoneNumber}`;
      }
      // TODO: Catch if this channel doesn't exist (should only be possible if Redis isn't kept up-to-date).
      // Consider fetching slackChannelIds from Slack instead.
      return SlackApiUtil.sendMessage(parentMessageText,
        {channel: destinationSlackChannelName}).then(response => {
          // Remember the voter's thread in this channel.
          userInfo[response.data.channel] = response.data.ts;

          // Be able to identify phone number using NEW Slack channel identifying info.
          RedisApiUtil.setHash(redisClient,
            `${response.data.channel}:${response.data.ts}`,
            {userPhoneNumber, twilioPhoneNumber});

          // The logic above this is for a voter's first time at a channel (e.g. create thread).
          // This function is separated so that it could be used to return a voter to
          // their thread in a channel they've already been in.
          return routeVoterToSlackChannelHelper(userInfo, redisClient, twilioPhoneNumber,
                                          {destinationSlackChannelName, destinationSlackChannelId: response.data.channel, destinationSlackParentMessageTs: response.data.ts});
        });
    // If this user HAS been to the destination channel, use the same thread info.
    } else {
      SlackApiUtil.sendMessage(`*Operator:* Voter ${userId} was routed from ${adminCommandParams.previousSlackChannelName} back to this channel by ${adminCommandParams.routingSlackUserName}. See their thread with ${twilioPhoneNumber} above.`,
        {channel: destinationSlackChannelId});
        return DbApiUtil.getTimestampOfLastMessageInThread(userInfo[destinationSlackChannelId]).then(timestampOfLastMessageInThread => {
          if (process.env.NODE_ENV !== "test")  console.log(`timestampOfLastMessageInThread: ${timestampOfLastMessageInThread}`);
          return SlackApiUtil.sendMessage(`*Operator:* Voter ${userId} was routed from ${adminCommandParams.previousSlackChannelName} back to this thread by ${adminCommandParams.routingSlackUserName}. Messages sent here will again relay to the voter.`,
            {channel: destinationSlackChannelId, parentMessageTs: userInfo[destinationSlackChannelId]}).then(() => {
            return routeVoterToSlackChannelHelper(userInfo, redisClient, twilioPhoneNumber,
                                            {destinationSlackChannelName, destinationSlackChannelId, destinationSlackParentMessageTs: userInfo[destinationSlackChannelId]},
                                            timestampOfLastMessageInThread);
        });
      });
    }
  });
};

exports.determineVoterState = (userOptions, redisClient, twilioPhoneNumber, inboundDbMessageEntry) => {
  const userInfo = userOptions.userInfo;
  const userPhoneNumber = userOptions.userPhoneNumber;
  const userId = userInfo.userId;
  const userMessage = userOptions.userMessage;

  userInfo.lastVoterMessageSecsFromEpoch = Math.round(Date.now() / 1000);

  const lobbyChannel = userInfo.activeChannelId;
  const lobbyParentMessageTs = userInfo[lobbyChannel];

  return SlackApiUtil.sendMessage(`*${userId.substring(0,5)}:* ${userMessage}`, {
    parentMessageTs: lobbyParentMessageTs,
    channel: lobbyChannel},
    inboundDbMessageEntry, userInfo).then(response => {
      const stateName = StateParser.determineState(userMessage);
      if (stateName == null) {
        if (process.env.NODE_ENV !== "test") console.log("State not determined");
        TwilioApiUtil.sendMessage(MessageConstants.CLARIFY_STATE, {userPhoneNumber, twilioPhoneNumber},
          DbApiUtil.populateAutomatedDbMessageEntry(userInfo)
        );
        SlackApiUtil.sendMessage(`*Automated Message:* ${MessageConstants.CLARIFY_STATE}`,
          {parentMessageTs: lobbyParentMessageTs, channel: lobbyChannel});

        userInfo.lastVoterMessageSecsFromEpoch = Math.round(Date.now() / 1000);
        return RedisApiUtil.setHash(redisClient, `${userId}:${twilioPhoneNumber}`, userInfo);
      } else {
        // This is used for display as well as to know later that the voter's
        // U.S. state has been determined.
        userInfo.stateName = stateName;

        TwilioApiUtil.sendMessage(MessageConstants.STATE_CONFIRMATION(stateName), {userPhoneNumber, twilioPhoneNumber},
          DbApiUtil.populateAutomatedDbMessageEntry(userInfo)
        );

        // Slack channel name must abide by the rules in this function.
        return LoadBalancer.selectChannelByRoundRobin(redisClient, userInfo.isDemo, stateName).then(selectedStateChannelName => {
          return SlackApiUtil.sendMessage(`*Automated Message:* ${MessageConstants.STATE_CONFIRMATION(stateName)}`,
                                    {parentMessageTs: lobbyParentMessageTs, channel: lobbyChannel}).then(() => {
            return routeVoterToSlackChannel(userInfo, redisClient, {userId, twilioPhoneNumber, destinationSlackChannelName: selectedStateChannelName});
          });
        });
      }
    });
};

exports.handleDisclaimer = (userOptions, redisClient, twilioPhoneNumber, inboundDbMessageEntry) => {
  const userInfo = userOptions.userInfo;
  const userId = userInfo.userId;
  const userMessage = userOptions.userMessage;
  const slackLobbyMessageParams = {
      parentMessageTs: userInfo[userInfo.activeChannelId],
      channel: userInfo.activeChannelId,
    };

  const nowSecondsEpoch = Math.round(Date.now() / 1000);
  userInfo.lastVoterMessageSecsFromEpoch = nowSecondsEpoch;

  SlackApiUtil.sendMessage(`*${userId.substring(0,5)}:* ${userMessage}`, slackLobbyMessageParams, inboundDbMessageEntry, userInfo).then(response => {
      const userMessageNoPunctuation = userOptions.userMessage.replace(/[.,?\/#!$%\^&\*;:{}=\-_`~()]/g, '');
      const cleared = userMessageNoPunctuation.toLowerCase().trim() == "agree";
      let automatedMessage;
      if (cleared) {
        userInfo.confirmedDisclaimer = true;
        automatedMessage = MessageConstants.DISCLAIMER_CONFIRMATION_AND_STATE_QUESTION;
      } else {
        automatedMessage = MessageConstants.CLARIFY_DISCLAIMER;
      }
      RedisApiUtil.setHash(redisClient, `${userId}:${twilioPhoneNumber}`, userInfo);
      TwilioApiUtil.sendMessage(automatedMessage, {userPhoneNumber: userOptions.userPhoneNumber, twilioPhoneNumber},
        DbApiUtil.populateAutomatedDbMessageEntry(userInfo)
      );
      SlackApiUtil.sendMessage(`*Automated Message:* ${automatedMessage}`, slackLobbyMessageParams);
    });
};

exports.handleClearedVoter = (userOptions, redisClient, twilioPhoneNumber, inboundDbMessageEntry) => {
  const userInfo = userOptions.userInfo;
  const userId = userInfo.userId;
  const userPhoneNumber = userOptions.userPhoneNumber;
  const activeChannelMessageParams = {
      parentMessageTs: userInfo[userInfo.activeChannelId],
      channel: userInfo.activeChannelId,
    };

  const nowSecondsEpoch = Math.round(Date.now() / 1000);
  // Remember the lastVoterMessageSecsFromEpoch, for use in calculation below.
  const lastVoterMessageSecsFromEpoch = userInfo.lastVoterMessageSecsFromEpoch;
  // Update the lastVoterMessageSecsFromEpoch, for use in DB write below.
  userInfo.lastVoterMessageSecsFromEpoch = nowSecondsEpoch;

  return SlackApiUtil.sendMessage(`*${userId.substring(0,5)}:* ${userOptions.userMessage}`,
    activeChannelMessageParams, inboundDbMessageEntry, userInfo).then(response => {
      if (process.env.NODE_ENV !== "test") console.log(`Seconds since last message from voter: ${nowSecondsEpoch - lastVoterMessageSecsFromEpoch}`);

      if (nowSecondsEpoch - lastVoterMessageSecsFromEpoch > MINS_BEFORE_WELCOME_BACK_MESSAGE * 60) {
        const welcomeBackMessage = MessageConstants.WELCOME_BACK(userInfo.stateName);
        TwilioApiUtil.sendMessage(welcomeBackMessage, {userPhoneNumber: userOptions.userPhoneNumber, twilioPhoneNumber});
        SlackApiUtil.sendMessage(`*Automated Message:* ${welcomeBackMessage}`, activeChannelMessageParams);
      }

      return RedisApiUtil.setHash(redisClient, `${userId}:${twilioPhoneNumber}`, userInfo);
    });
};

exports.handleSlackVoterThreadMessage = (req, redisClient, redisData, originatingSlackUserName) => {
  const reqBody = req.body;

  const userPhoneNumber = redisData.userPhoneNumber;
  const twilioPhoneNumber = redisData.twilioPhoneNumber;
  if (userPhoneNumber) {
    const unprocessedSlackMessage = reqBody.event.text;
    if (process.env.NODE_ENV !== "test") console.log(`Received message from Slack: ${unprocessedSlackMessage}`);

    // If the message doesnt need processing.
    let messageToSend = unprocessedSlackMessage;
    let unprocessedMessageToLog = null;
    const processedSlackMessage = MessageParser.processMessageText(unprocessedSlackMessage);
    // If the message did need processing.
    if (processedSlackMessage != null) {
      messageToSend = processedSlackMessage;
      unprocessedMessageToLog = unprocessedSlackMessage;
    }

    const MD5 = new Hashes.MD5;
    const userId = MD5.hex(userPhoneNumber);

    const outboundDbMessageEntry = DbApiUtil.populateIncomingDbMessageSlackEntry({
      userId,
      originatingSlackUserName,
      originatingSlackUserId: reqBody.event.user,
      slackChannel: reqBody.event.channel,
      slackParentMessageTs: reqBody.event.thread_ts,
      slackMessageTs: reqBody.event.ts,
      unprocessedMessage: unprocessedMessageToLog,
      slackRetryNum: req.header('X-Slack-Retry-Num'),
      slackRetryReason: req.header('X-Slack-Retry-Reason'),
    });

    RedisApiUtil.getHash(redisClient, `${userId}:${twilioPhoneNumber}`).then(userInfo => {
      // Only relay Slack messages from the active Slack thread.
      if (userInfo.activeChannelId === reqBody.event.channel) {
        userInfo.lastVoterMessageSecsFromEpoch = Math.round(Date.now() / 1000);
        if (!userInfo.volunteerEngaged) {
          if (process.env.NODE_ENV !== "test") console.log("Router: volunteer engaged, suppressing automated system.")
          userInfo.volunteerEngaged = true;
        }
        RedisApiUtil.setHash(redisClient, `${userId}:${twilioPhoneNumber}`, userInfo);
        DbApiUtil.updateDbMessageEntryWithUserInfo(userInfo, outboundDbMessageEntry);
        TwilioApiUtil.sendMessage(messageToSend,
                                  {userPhoneNumber,
                                    twilioPhoneNumber},
                                    outboundDbMessageEntry);
      // Slack message is from inactive Slack thread.
      } else {
        SlackApiUtil.sendMessage(`*Operator:* Your message was not relayed, as this thread is inactive. The voter's active thread is in #${userInfo.activeChannelName}.`,
                                      {channel: reqBody.event.channel, parentMessageTs: reqBody.event.thread_ts});
      }
    });
  }
};

exports.handleSlackAdminCommand = (reqBody, redisClient, originatingSlackUserName) => {
  const adminCommandArgs = AdminUtil.parseAdminSlackMessage(reqBody.event.text);
  if (process.env.NODE_ENV !== "test") console.log(`Parsed admin control command params: ${JSON.stringify(adminCommandArgs)}`)
  if (adminCommandArgs) {
    const redisHashKey = `${adminCommandArgs.userId}:${adminCommandArgs.twilioPhoneNumber}`;
    RedisApiUtil.getHash(redisClient, redisHashKey).then(userInfo => {
      // This catches invalid userPhoneNumber:twilioPhoneNumber pairs.
      if (!userInfo) {
        if (process.env.NODE_ENV !== "test") console.log("Router.handleSlackAdminCommand: No Redis data found for userId:twilioPhoneNumber pair.");
        SlackApiUtil.sendMessage(`*Operator:* No record found for user ID (${adminCommandArgs.userId}) and/or Twilio phone number (${adminCommandArgs.twilioPhoneNumber}).`,
                                        {channel: process.env.ADMIN_CONTROL_ROOM_SLACK_CHANNEL_ID, parentMessageTs: reqBody.event.ts});
      // userPhoneNumber:twilioPhoneNumber pair found successfully.
      } else {
        // Voter already in destination slack channel (error).
        if (userInfo.activeChannelName === adminCommandArgs.destinationSlackChannelName) {
          SlackApiUtil.sendMessage(`*Operator:* Voter's thread in #${userInfo.activeChannelName} is already the active thread.`,
                                          {channel: process.env.ADMIN_CONTROL_ROOM_SLACK_CHANNEL_ID, parentMessageTs: reqBody.event.ts});
        } else {
          const adminCommandParams = {
            commandParentMessageTs: reqBody.event.ts,
            previousSlackChannelName: userInfo.activeChannelName,
            routingSlackUserName: originatingSlackUserName,
          };
          routeVoterToSlackChannel(userInfo, redisClient, adminCommandArgs, adminCommandParams);
        }
      }
    });
  } else {
    SlackApiUtil.sendMessage(`*Operator:* Your command could not be parsed (did you closely follow the required format)?`,
                                    {channel: process.env.ADMIN_CONTROL_ROOM_SLACK_CHANNEL_ID, parentMessageTs: reqBody.event.ts});
  }
};
