const MessageConstants = require('./message_constants');
const SlackApiUtil = require('./slack_api_util');
const TwilioApiUtil = require('./twilio_api_util');
const MessageParserUtil = require('./message_parser_util');
const RouterUtil = require('./router_util');

const MINS_BEFORE_WELCOME_BACK_MESSAGE = 60;

exports.handleNewVoter = (userOptions, redisClient, twilioPhoneNumber) => {
  const userPhoneNumber = userOptions.userPhoneNumber;
  const userId = userOptions.userId;
  const userMessage = userOptions.userMessage;
  const userInfo = {};
  userInfo.lobby = {};
  userInfo.messageHistory = [`${userId}: ${userMessage}`, `Automated Message: ${MessageConstants.WELCOME}`];
  userInfo.isDemo = twilioPhoneNumber == "+19842318683";
  userInfo.confirmedDisclaimer = false;

  let welcomeMessage = MessageConstants.WELCOME;
  userInfo.lobby.channel = "#lobby";
  let operatorMessage = `<!channel> Operator: New voter! (${userId}).`;

  if (userInfo.isDemo) {
    userInfo.lobby.channel = "#demo-lobby";
  }

  // if (twilioPhoneNumber == process.env.TWILIO_PHONE_NUMBER_SINGLE_LINE) {
  //   welcomeMessage = MessageConstants.WELCOME_NC;
  //   entryChannel = "#north-carolina";
  //   operatorMessage = `<!channel> Operator: New direct North Carolina voter! (${userId}).`;
  //   redisClientChannelKey = "stateChannel";
  //   isDemo = false;
  // }

  // Welcome the voter
  TwilioApiUtil.sendMessage(welcomeMessage, {userPhoneNumber, twilioPhoneNumber});

  // In Slack, create entry channel message, followed by voter's message and intro text.
  SlackApiUtil.sendMessage(operatorMessage,
  {
    channel: userInfo.lobby.channel,
  }).then(response => {
    // Remember the lobby thread for this user.
    userInfo.lobby.parentMessageTs = response.data.ts;
    // Pass the voter's message along to the Slack lobby thread,
    // and show in the Slack lobby thread the welcome message the voter received
    // in response.
    SlackApiUtil.sendMessages([`${userId}: ${userMessage}`,
                                `Automated Message: ${welcomeMessage}`],
                              {parentMessageTs: userInfo.lobby.parentMessageTs, channel: userInfo.lobby.channel});

    userInfo.lastVoterMessageSecsFromEpoch = Math.round(Date.now() / 1000);

    // Add key/value such that given a user phone number we can get the
    // Slack lobby thread associated with that user.
    redisClient.setAsync(userPhoneNumber, JSON.stringify(userInfo));

    // Add key/value such that given Slack thread data we can get a
    // user phone number.
    redisClient.setAsync(`${response.data.channel}:${userInfo.lobby.parentMessageTs}`,
                        JSON.stringify({userPhoneNumber, twilioPhoneNumber}));
  });
}

const introduceVoterToStateChannel = (userOptions, redisClient, twilioPhoneNumber) => {
  const userId = userOptions.userId;
  const userPhoneNumber = userOptions.userPhoneNumber;
  const userInfo = userOptions.userInfo;

  // Create thread in state channel.
  return SlackApiUtil.sendMessage(`<!channel> Operator: New ${userInfo.stateName} voter! (${userId}).`,
    {channel: userInfo.stateChannel.channel}).then(response => {
      userInfo.stateChannel.parentMessageTs = response.data.ts;

      userInfo.lastVoterMessageSecsFromEpoch = Math.round(Date.now() / 1000);
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

exports.determineVoterState = (userOptions, redisClient, twilioPhoneNumber) => {
  const userInfo = userOptions.userInfo;
  const userPhoneNumber = userOptions.userPhoneNumber;
  const userId = userOptions.userId;
  const userMessage = userOptions.userMessage;

  userInfo.messageHistory.push(`${userId}: ${userMessage}`);
  // TODO: Don't wait for this to do the rest of the stuff. ie take out the then
  return SlackApiUtil.sendMessage(`${userId}: ${userMessage}`, {
    parentMessageTs: userInfo.lobby.parentMessageTs,
    channel: userInfo.lobby.channel}).then(response => {
      const stateName = MessageParserUtil.determineState(userMessage);
      if (stateName == null) {
        console.log("State not determined");
        TwilioApiUtil.sendMessage(MessageConstants.CLARIFY_STATE, {userPhoneNumber, twilioPhoneNumber});
        SlackApiUtil.sendMessage(`Automated Message: ${MessageConstants.CLARIFY_STATE}`,
          {parentMessageTs: userInfo.lobby.parentMessageTs, channel: userInfo.lobby.channel});
        userInfo.messageHistory.push(`Automated Message: ${MessageConstants.CLARIFY_STATE}`);

        userInfo.lastVoterMessageSecsFromEpoch = Math.round(Date.now() / 1000);
        // TODO: Do this after the if/else because it's done in both branches
        return redisClient.setAsync(userPhoneNumber, JSON.stringify(userInfo));
      } else {
        userInfo.stateName = stateName;

        // Slack channel name must abide by this rule.
        userInfo.stateChannel = {};
        userInfo.stateChannel.channel = stateName.toLowerCase().replace(/\s/g, '-');
        if (userInfo.isDemo) {
          userInfo.stateChannel.channel = `demo-${userInfo.stateChannel.channel}`;
        }
        TwilioApiUtil.sendMessage(MessageConstants.STATE_CONFIRMATION_AND_DISCLAIMER(stateName), {userPhoneNumber, twilioPhoneNumber});
        userInfo.messageHistory.push(`Automated Message: ${MessageConstants.STATE_CONFIRMATION_AND_DISCLAIMER(stateName)}`);

        SlackApiUtil.sendMessages([`Automated Message: ${MessageConstants.STATE_CONFIRMATION_AND_DISCLAIMER(stateName)}`,
                                    `Operator: Routing voter to #${userInfo.stateChannel.channel}.`],
                                  {parentMessageTs: userInfo.lobby.parentMessageTs, channel: userInfo.lobby.channel});

        return introduceVoterToStateChannel({userPhoneNumber, userId, userInfo}, redisClient, twilioPhoneNumber);
      }
    });
}

exports.handleDisclaimer = (options, redisClient, twilioPhoneNumber) => {
  const userInfo = options.userInfo;
  SlackApiUtil.sendMessage(`${options.userId}: ${options.userMessage}`,
    {
      parentMessageTs: userInfo.stateChannel.parentMessageTs,
      channel: userInfo.stateChannel.channel,
    }).then(response => {
      const userMessageNoPunctuation = options.userMessage.replace(/[.,?\/#!$%\^&\*;:{}=\-_`~()]/g, '');
      const cleared = userMessageNoPunctuation.toLowerCase().trim() == "agree";
      if (cleared) {
        userInfo.confirmedDisclaimer = true;
        TwilioApiUtil.sendMessage(MessageConstants.DISCLAIMER_CONFIRMATION, {userPhoneNumber: options.userPhoneNumber, twilioPhoneNumber});
        SlackApiUtil.sendMessage(`Automated Message: ${MessageConstants.DISCLAIMER_CONFIRMATION}`,
          {
            parentMessageTs: userInfo.stateChannel.parentMessageTs,
            channel: userInfo.stateChannel.channel,
          });

        redisClient.setAsync(options.userPhoneNumber, JSON.stringify(userInfo));
      } else {
        TwilioApiUtil.sendMessage(MessageConstants.CLARIFY_DISCLAIMER, {userPhoneNumber: options.userPhoneNumber, twilioPhoneNumber});
        SlackApiUtil.sendMessage(`Automated Message: ${MessageConstants.CLARIFY_DISCLAIMER}`,
          {
            parentMessageTs: userInfo.stateChannel.parentMessageTs,
            channel: userInfo.stateChannel.channel,
          });
      }
      // TODO: Need to add update to lastVoterMessageSecsFromEpoch, maybe have it done in server
    });
}

exports.handleClearedVoter = (options, redisClient, twilioPhoneNumber) => {
  const userInfo = options.userInfo;
  const userId = options.userId;
  SlackApiUtil.sendMessage(`${userId}: ${options.userMessage}`,
    {
      parentMessageTs: userInfo.stateChannel.parentMessageTs,
      channel: userInfo.stateChannel.channel,
    }).then(response => {
      const nowSecondsEpoch = Math.round(Date.now() / 1000);
      console.log(`Seconds since last message from voter: ${nowSecondsEpoch - userInfo.lastVoterMessageSecsFromEpoch}`);
      if (nowSecondsEpoch - userInfo.lastVoterMessageSecsFromEpoch > MINS_BEFORE_WELCOME_BACK_MESSAGE * 60) {
        const welcomeBackMessage = MessageConstants.WELCOME_BACK(userInfo.stateName);
        TwilioApiUtil.sendMessage(welcomeBackMessage, {userPhoneNumber: options.userPhoneNumber, twilioPhoneNumber});
        SlackApiUtil.sendMessage(`Automated Message: ${welcomeBackMessage}`,
          {
            parentMessageTs: userInfo.stateChannel.parentMessageTs,
            channel: userInfo.stateChannel.channel,
          });
      }

      userInfo.lastVoterMessageSecsFromEpoch = nowSecondsEpoch;
      redisClient.setAsync(userPhoneNumber, JSON.stringify(userInfo));
    });
}
