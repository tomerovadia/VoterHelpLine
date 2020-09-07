if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
  require('dotenv').config();
}

const MessageConstants = require('./message_constants');
const SlackApiUtil = require('./slack_api_util');
const TwilioApiUtil = require('./twilio_api_util');
const StateParser = require('./state_parser');
const RouterUtil = require('./router_util');
const DbApiUtil = require('./db_api_util');
const RedisApiUtil = require('./redis_api_util');
const LoadBalancer = require('./load_balancer');
const Hashes = require('jshashes'); // v1.0.5
const SlackMessageFormatter = require('./slack_message_formatter'); // v1.0.5

const MINS_BEFORE_WELCOME_BACK_MESSAGE = 60;

exports.handleNewVoter = (userOptions, redisClient, twilioPhoneNumber, inboundDbMessageEntry) => {
  const userPhoneNumber = userOptions.userPhoneNumber;
  const userMessage = userOptions.userMessage;

  const userInfo = {};

  const MD5 = new Hashes.MD5;
  userInfo.userId = MD5.hex(userPhoneNumber);
  userInfo.isDemo = false;
  if (twilioPhoneNumber == process.env.DEMO_PHONE_NUMBER ||
      twilioPhoneNumber == process.env.PREVIOUS_DEMO_PHONE_NUMBER ||
      userPhoneNumber == process.env.TESTER_PHONE_NUMBER) {
    userInfo.isDemo = true;
  }
  userInfo.confirmedDisclaimer = false;

  let welcomeMessage = MessageConstants.WELCOME_AND_DISCLAIMER;
  let lobbyChannel = "#lobby";
  let operatorMessage = `<!channel> New voter! (${userInfo.userId}).`;

  if (userInfo.isDemo) {
    lobbyChannel = "#demo-lobby";
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
    userInfo.activeChannel = response.data.channel;

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

const introduceVoterToStateChannel = (userOptions, redisClient, twilioPhoneNumber, newSlackChannelPretty) => {
  const userPhoneNumber = userOptions.userPhoneNumber;
  const userInfo = userOptions.userInfo;
  const userId = userInfo.userId;
  let parentMessageText = `<!channel> New ${userInfo.stateName} voter! (${userId}).`;
  // if (slackUserIdOfRouter) {
  //   parentMessageText = `<!channel> Voter routed from ${userOptions.activeChannel} (${userId}).`;
  // }

  // Create thread in state channel.
  return SlackApiUtil.sendMessage(parentMessageText,
    {channel: newSlackChannelPretty}).then(response => {
      userInfo[response.data.channel] = response.data.ts;

      // Reassign the active channel so that the next voter messages go to the
      // new active channel.
      userInfo.activeChannel = response.data.channel;

      // Remember state channel thread identifying info.
      RedisApiUtil.setHash(redisClient, `${userId}:${twilioPhoneNumber}`, userInfo);

      // Be able to identify phone number using STATE channel identifying info.
      RedisApiUtil.setHash(redisClient,
        `${response.data.channel}:${response.data.ts}`,
        {userPhoneNumber, twilioPhoneNumber});

      // Populate state channel thread with message history so far.
      return DbApiUtil.getMessageHistoryFor(userId).then(messageHistory => {
        const formattedMessageHistory = SlackMessageFormatter.formatMessageHistory(messageHistory, userId.substring(0,5));

        return SlackApiUtil.sendMessage(`*Operator:* Below is the voter's message history so far.\n\n${formattedMessageHistory}`, {parentMessageTs: response.data.ts,
                                                   channel: response.data.channel});
      });
    });
};

exports.determineVoterState = (userOptions, redisClient, twilioPhoneNumber, inboundDbMessageEntry) => {
  const userInfo = userOptions.userInfo;
  const userPhoneNumber = userOptions.userPhoneNumber;
  const userId = userInfo.userId;
  const userMessage = userOptions.userMessage;

  userInfo.lastVoterMessageSecsFromEpoch = Math.round(Date.now() / 1000);

  const lobbyChannel = userInfo.activeChannel;
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
        return LoadBalancer.selectChannelByRoundRobin(redisClient, userInfo.isDemo, stateName).then(selectedStateChannelPretty => {
          return SlackApiUtil.sendMessages([`*Automated Message:* ${MessageConstants.STATE_CONFIRMATION(stateName)}`,
                                      `Operator: Routing voter to #${selectedStateChannelPretty}.`],
                                    {parentMessageTs: lobbyParentMessageTs, channel: lobbyChannel}).then(() => {
            return introduceVoterToStateChannel({userPhoneNumber, userId, userInfo}, redisClient, twilioPhoneNumber, selectedStateChannelPretty);
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
      parentMessageTs: userInfo[userInfo.activeChannel],
      channel: userInfo.activeChannel,
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
      parentMessageTs: userInfo[userInfo.activeChannel],
      channel: userInfo.activeChannel,
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
