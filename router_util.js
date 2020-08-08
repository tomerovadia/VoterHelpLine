const MessageConstants = require('./message_constants');
const SlackApiUtil = require('./slack_api_util');
const TwilioApiUtil = require('./twilio_api_util');
const MessageParserUtil = require('./message_parser_util');
const RouterUtil = require('./router_util');
const DbApiUtil = require('./db_api_util');
const Hashes = require('jshashes'); // v1.0.5

const MINS_BEFORE_WELCOME_BACK_MESSAGE = 60;

exports.handleNewVoter = (userOptions, redisClient, twilioPhoneNumber, inboundDbMessageEntry) => {
  const userPhoneNumber = userOptions.userPhoneNumber;
  const userMessage = userOptions.userMessage;

  const userInfo = {};

  const MD5 = new Hashes.MD5;
  userInfo.userId = MD5.hex(userPhoneNumber);
  userInfo.lobby = {};
  userInfo.messageHistory = [`${userInfo.userId}: ${userMessage}`, `Automated Message: ${MessageConstants.WELCOME_AND_DISCLAIMER}`];
  userInfo.isDemo = twilioPhoneNumber == "+15619338683";
  if (userPhoneNumber == process.env.TESTER_PHONE_NUMBER) {
    userInfo.isDemo = true;
  }
  userInfo.confirmedDisclaimer = false;

  let welcomeMessage = MessageConstants.WELCOME_AND_DISCLAIMER;
  userInfo.lobby.channel = "#lobby";
  let operatorMessage = `<!channel> Operator: New voter! (${userInfo.userId}).`;

  if (userInfo.isDemo) {
    userInfo.lobby.channel = "#demo-lobby";
  }

  userInfo.lastVoterMessageSecsFromEpoch = Math.round(Date.now() / 1000);

  // Welcome the voter
  TwilioApiUtil.sendMessage(welcomeMessage, {userPhoneNumber, twilioPhoneNumber},
      DbApiUtil.populateAutomatedDbMessageEntry(userInfo)
    );

  // In Slack, create entry channel message, followed by voter's message and intro text.
  SlackApiUtil.sendMessage(operatorMessage,
  {
    channel: userInfo.lobby.channel,
  }).then(response => {
    // Remember the lobby thread for this user.
    userInfo.lobby.parentMessageTs = response.data.ts;

    // Reassign the channel to the ID version.
    userInfo.lobby.channel = response.data.channel;

    // Pass the voter's message along to the Slack lobby thread,
    // and show in the Slack lobby thread the welcome message the voter received
    // in response.
    SlackApiUtil.sendMessage(`${userInfo.userId}: ${userMessage}`,
      {parentMessageTs: userInfo.lobby.parentMessageTs, channel: userInfo.lobby.channel}, inboundDbMessageEntry, userInfo);
    SlackApiUtil.sendMessage(`Automated Message: ${welcomeMessage}`,
      {parentMessageTs: userInfo.lobby.parentMessageTs, channel: userInfo.lobby.channel});

    // Add key/value such that given a user phone number we can get the
    // Slack lobby thread associated with that user.
    redisClient.setAsync(userPhoneNumber, JSON.stringify(userInfo));

    // Add key/value such that given Slack thread data we can get a
    // user phone number.
    redisClient.setAsync(`${userInfo.lobby.channel}:${userInfo.lobby.parentMessageTs}`,
                        JSON.stringify({userPhoneNumber, twilioPhoneNumber}));
  });
};

const introduceVoterToStateChannel = (userOptions, redisClient, twilioPhoneNumber) => {
  const userPhoneNumber = userOptions.userPhoneNumber;
  const userInfo = userOptions.userInfo;
  const userId = userInfo.userId;

  // Create thread in state channel.
  return SlackApiUtil.sendMessage(`<!channel> Operator: New ${userInfo.stateName} voter! (${userId}).`,
    {channel: userInfo.stateChannel.channel}).then(response => {
      userInfo.stateChannel.parentMessageTs = response.data.ts;

      // Reassign the channel to the ID version.
      userInfo.stateChannel.channel = response.data.channel;

      // Remember state channel thread identifying info.
      redisClient.setAsync(userPhoneNumber, JSON.stringify(userInfo));

      // Be able to identify phone number using STATE channel identifying info.
      redisClient.setAsync(`${response.data.channel}:${userInfo.stateChannel.parentMessageTs}`,
                          JSON.stringify({userPhoneNumber, twilioPhoneNumber}));

      // Populate state channel thread with message history so far.
      return SlackApiUtil.sendMessages(userInfo.messageHistory, {parentMessageTs: userInfo.stateChannel.parentMessageTs,
                                                 channel: userInfo.stateChannel.channel});
    });
}

exports.determineVoterState = (userOptions, redisClient, twilioPhoneNumber, inboundDbMessageEntry) => {
  const userInfo = userOptions.userInfo;
  const userPhoneNumber = userOptions.userPhoneNumber;
  const userId = userInfo.userId;
  const userMessage = userOptions.userMessage;

  userInfo.lastVoterMessageSecsFromEpoch = Math.round(Date.now() / 1000);

  userInfo.messageHistory.push(`${userId}: ${userMessage}`);
  return SlackApiUtil.sendMessage(`${userId}: ${userMessage}`, {
    parentMessageTs: userInfo.lobby.parentMessageTs,
    channel: userInfo.lobby.channel},
    inboundDbMessageEntry, userInfo).then(response => {
      const stateName = MessageParserUtil.determineState(userMessage);
      if (stateName == null) {
        console.log("State not determined");
        TwilioApiUtil.sendMessage(MessageConstants.CLARIFY_STATE, {userPhoneNumber, twilioPhoneNumber},
          DbApiUtil.populateAutomatedDbMessageEntry(userInfo)
        );
        SlackApiUtil.sendMessage(`Automated Message: ${MessageConstants.CLARIFY_STATE}`,
          {parentMessageTs: userInfo.lobby.parentMessageTs, channel: userInfo.lobby.channel});
        userInfo.messageHistory.push(`Automated Message: ${MessageConstants.CLARIFY_STATE}`);

        userInfo.lastVoterMessageSecsFromEpoch = Math.round(Date.now() / 1000);
        return redisClient.setAsync(userPhoneNumber, JSON.stringify(userInfo));
      } else {
        userInfo.stateName = stateName;

        // Slack channel name must abide by this rule.
        userInfo.stateChannel = {};
        userInfo.stateChannel.channel = stateName.toLowerCase().replace(/\s/g, '-');
        if (userInfo.isDemo) {
          userInfo.stateChannel.channel = `demo-${userInfo.stateChannel.channel}`;
        }
        TwilioApiUtil.sendMessage(MessageConstants.STATE_CONFIRMATION(stateName), {userPhoneNumber, twilioPhoneNumber},
          DbApiUtil.populateAutomatedDbMessageEntry(userInfo)
        );
        userInfo.messageHistory.push(`Automated Message: ${MessageConstants.STATE_CONFIRMATION(stateName)}`);

        SlackApiUtil.sendMessages([`Automated Message: ${MessageConstants.STATE_CONFIRMATION(stateName)}`,
                                    `Operator: Routing voter to #${userInfo.stateChannel.channel}.`],
                                  {parentMessageTs: userInfo.lobby.parentMessageTs, channel: userInfo.lobby.channel});

        return introduceVoterToStateChannel({userPhoneNumber, userId, userInfo}, redisClient, twilioPhoneNumber);
      }
    });
};

exports.handleDisclaimer = (options, redisClient, twilioPhoneNumber, inboundDbMessageEntry) => {
  const userInfo = options.userInfo;
  const userId = userInfo.userId;
  const userMessage = options.userMessage;
  const slackLobbyMessageParams = {
      parentMessageTs: userInfo.lobby.parentMessageTs,
      channel: userInfo.lobby.channel,
    };
  userInfo.messageHistory.push(`${userId}: ${userMessage}`);

  const nowSecondsEpoch = Math.round(Date.now() / 1000);
  userInfo.lastVoterMessageSecsFromEpoch = nowSecondsEpoch;

  SlackApiUtil.sendMessage(`${userId}: ${userMessage}`, slackLobbyMessageParams, inboundDbMessageEntry, userInfo).then(response => {
      const userMessageNoPunctuation = options.userMessage.replace(/[.,?\/#!$%\^&\*;:{}=\-_`~()]/g, '');
      const cleared = userMessageNoPunctuation.toLowerCase().trim() == "agree";
      let automatedMessage;
      if (cleared) {
        userInfo.confirmedDisclaimer = true;
        automatedMessage = MessageConstants.DISCLAIMER_CONFIRMATION_AND_STATE_QUESTION;
      } else {
        automatedMessage = MessageConstants.CLARIFY_DISCLAIMER;
      }
      userInfo.messageHistory.push(`Automated Message: ${automatedMessage}`);
      redisClient.setAsync(options.userPhoneNumber, JSON.stringify(userInfo));
      TwilioApiUtil.sendMessage(automatedMessage, {userPhoneNumber: options.userPhoneNumber, twilioPhoneNumber},
        DbApiUtil.populateAutomatedDbMessageEntry(userInfo)
      );
      SlackApiUtil.sendMessage(`Automated Message: ${automatedMessage}`, slackLobbyMessageParams);
    });
}

exports.handleClearedVoter = (options, redisClient, twilioPhoneNumber, inboundDbMessageEntry) => {
  const userInfo = options.userInfo;
  const userId = userInfo.userId;
  const userPhoneNumber = options.userPhoneNumber;
  const slackStateChannelMessageParams = {
      parentMessageTs: userInfo.stateChannel.parentMessageTs,
      channel: userInfo.stateChannel.channel,
    };
  SlackApiUtil.sendMessage(`${userId}: ${options.userMessage}`,
    slackStateChannelMessageParams,
    inboundDbMessageEntry, userInfo).then(response => {
      const nowSecondsEpoch = Math.round(Date.now() / 1000);
      console.log(`Seconds since last message from voter: ${nowSecondsEpoch - userInfo.lastVoterMessageSecsFromEpoch}`);
      if (nowSecondsEpoch - userInfo.lastVoterMessageSecsFromEpoch > MINS_BEFORE_WELCOME_BACK_MESSAGE * 60) {
        const welcomeBackMessage = MessageConstants.WELCOME_BACK(userInfo.stateName);
        TwilioApiUtil.sendMessage(welcomeBackMessage, {userPhoneNumber: options.userPhoneNumber, twilioPhoneNumber});
        SlackApiUtil.sendMessage(`Automated Message: ${welcomeBackMessage}`, slackStateChannelMessageParams);
      }

      userInfo.lastVoterMessageSecsFromEpoch = nowSecondsEpoch;
      redisClient.setAsync(userPhoneNumber, JSON.stringify(userInfo));
    });
}
