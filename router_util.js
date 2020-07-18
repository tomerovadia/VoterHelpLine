const MessageConstants = require('./message_constants');
const SlackApiUtil = require('./slack_api_util');
const TwilioApiUtil = require('./twilio_api_util');
const MessageParserUtil = require('./message_parser_util');

const MINS_BEFORE_WELCOME_BACK_MESSAGE = 60;

exports.handleNewVoter = (userOptions, redisClient, twilioPhoneNumber) => {
  const userPhoneNumber = userOptions.userPhoneNumber;
  const userMessage = userOptions.userMessage;
  const userInfo = {};
  userInfo.lobby = {};
  userInfo.messageHistory = [`${userPhoneNumber}: ${userMessage}`, `Automated Message: ${MessageConstants.WELCOME}`];
  userInfo.isDemo = twilioPhoneNumber == process.env.TWILIO_PHONE_NUMBER_DEMO_LINE;

  let welcomeMessage = MessageConstants.WELCOME;
  userInfo.lobby.channel = "#lobby";
  let operatorMessage = `<!channel> Operator: New voter! (${userPhoneNumber}).`;


  if (userInfo.isDemo) {
    userInfo.lobby.channel = "#demo-lobby";
  }

  // if (twilioPhoneNumber == process.env.TWILIO_PHONE_NUMBER_SINGLE_LINE) {
  //   welcomeMessage = MessageConstants.WELCOME_NC;
  //   entryChannel = "#north-carolina";
  //   operatorMessage = `<!channel> Operator: New direct North Carolina voter! (${userPhoneNumber}).`;
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
    SlackApiUtil.sendMessages([`${userPhoneNumber}: ${userMessage}`,
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

const introduceVoterToStateChannel = (userOptions, redisClient) => {
  const userPhoneNumber = userOptions.userPhoneNumber;
  let userInfo = userOptions.userInfo;

  // Create thread in state channel.
  SlackApiUtil.sendMessage(`<!channel> Operator: New ${userInfo.stateName} voter! (${userPhoneNumber}).`, {channel: userInfo.stateChannel.channel}).then(response => {
    userInfo.stateChannel.parentMessageTs = response.data.ts;

    // Populate state channel thread with message history so far.
    SlackApiUtil.sendMessages(userInfo.messageHistory, {parentMessageTs: userInfo.stateChannel.parentMessageTs,
                                               channel: userInfo.stateChannel.channel});

    userInfo.lastVoterMessageSecsFromEpoch = Math.round(Date.now() / 1000);
    // Remember state channel thread identifying info.
    redisClient.setAsync(userPhoneNumber, JSON.stringify(userInfo));

    // Be able to identify phone number using state channel identifying info.
    redisClient.setAsync(`${response.data.channel}:${userInfo.stateChannel.parentMessageTs}`,
                        JSON.stringify({userPhoneNumber, twilioPhoneNumber}));
  });
}

exports.determineVoterState = (userOptions, redisClient, twilioPhoneNumber) => {
  const userInfo = userOptions.userInfo;
  const userPhoneNumber = userOptions.userPhoneNumber;
  const userMessage = userOptions.userMessage;

  userInfo.messageHistory.push(`${userPhoneNumber}: ${userMessage}`);
  SlackApiUtil.sendMessage(`${userPhoneNumber}: ${userMessage}`, {
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
        redisClient.setAsync(userPhoneNumber,
                            JSON.stringify(userInfo));
      } else {
        userInfo.stateName = stateName;

        // Slack channel name must abide by this rule.
        userInfo.stateChannel = {};
        userInfo.stateChannel.channel = stateName.toLowerCase().replace(/\s/g, '-');
        if (userInfo.isDemo) {
          userInfo.stateChannel.channel = `demo-${userInfo.stateChannel.channel}`;
        }
        TwilioApiUtil.sendMessage(MessageConstants.STATE_CONFIRMATION(stateName), {userPhoneNumber, twilioPhoneNumber});
        userInfo.messageHistory.push(`Automated Message: ${MessageConstants.STATE_CONFIRMATION(stateName)}`);

        SlackApiUtil.sendMessages([`Automated Message: ${MessageConstants.STATE_CONFIRMATION(stateName)}`,
                                    `Operator: Routing voter to #${userInfo.stateChannel.channel}.`],
                                  {parentMessageTs: userInfo.lobby.parentMessageTs, channel: userInfo.lobby.channel});
        introduceVoterToStateChannel({userPhoneNumber, userInfo}, redisClient);
      }
    });
}

exports.handleKnownStateVoter = (options, redisClient, twilioPhoneNumber) => {
  SlackApiUtil.sendMessage(`${options.userPhoneNumber}: ${options.userMessage}`,
    {
      parentMessageTs: options.userInfo.stateChannel.parentMessageTs,
      channel: options.userInfo.stateChannel.channel,
    }).then(response => {
      const nowSecondsEpoch = Math.round(Date.now() / 1000);
      console.log(`Seconds since last message from voter: ${nowSecondsEpoch - options.userInfo.lastVoterMessageSecsFromEpoch}`);
      if (nowSecondsEpoch - options.userInfo.lastVoterMessageSecsFromEpoch > MINS_BEFORE_WELCOME_BACK_MESSAGE * 60) {
        const welcomeBackMessage = MessageConstants.WELCOME_BACK(options.userInfo.stateName);
        TwilioApiUtil.sendMessage(welcomeBackMessage, {userPhoneNumber: options.userPhoneNumber, twilioPhoneNumber});
        SlackApiUtil.sendMessage(`Automated Message: ${welcomeBackMessage}`,
          {
            parentMessageTs: options.userInfo.stateChannel.parentMessageTs,
            channel: options.userInfo.stateChannel.channel,
          });
      }

      options.userInfo.lastVoterMessageSecsFromEpoch = nowSecondsEpoch;
      redisClient.setAsync(userPhoneNumber, JSON.stringify(options.userInfo));
    });
}
