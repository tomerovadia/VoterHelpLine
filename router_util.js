const MessageConstants = require('./message_constants');
const SlackApiUtil = require('./slack_api_util');
const TwilioApiUtil = require('./twilio_api_util');
const MessageParserUtil = require('./message_parser_util');

const MINS_BEFORE_WELCOME_BACK_MESSAGE = 60;

exports.handleNewVoter = (userOptions, redisClient) => {
  const userPhoneNumber = userOptions.userPhoneNumber;
  const userMessage = userOptions.userMessage;
  const messageHistory = [`${userPhoneNumber}: ${userMessage}`, `EffingVote: ${MessageConstants.WELCOME}`];

  // Welcome the voter
  TwilioApiUtil.sendMessage(MessageConstants.WELCOME, {userPhoneNumber});

  const lobbyChannel = "#lobby";

  // In Slack, create lobby entry, followed by voter's message and intro text.
  SlackApiUtil.sendMessage(`Operator: New voter! (${userPhoneNumber}).`,
  {
    channel: lobbyChannel,
  }).then(response => {
    const slackLobbyTs = response.data.ts;

    // Pass the voter's message along to the Slack lobby thread,
    // and show in the Slack lobby thread the welcome message the voter received
    // in response.
    SlackApiUtil.sendMessages([`${userPhoneNumber}: ${userMessage}`, `EffingVote: ${MessageConstants.WELCOME}`],
                              {parentMessageTs: slackLobbyTs, channel: response.data.channel});

    const secondsSinceEpoch = Math.round(Date.now() / 1000);
    // Add key/value such that given a user phone number we can get the
    // Slack lobby thread associated with that user.
    redisClient.setAsync(userPhoneNumber,
                        JSON.stringify({
                          lobby: {
                            parentMessageTs: response.data.ts,
                            channel: response.data.channel,
                          },
                          messageHistory,
                          lastVoterMessageSecsFromEpoch: secondsSinceEpoch,
                        }));

    // Add key/value such that given Slack thread data we can get a
    // user phone number.
    redisClient.setAsync(`${response.data.channel}:${response.data.ts}`,
                        JSON.stringify({userPhoneNumber}));
  });
}

const introduceVoterToStateChannel = (userOptions, redisClient) => {
  const stateChannel = userOptions.stateChannel;
  const stateName = userOptions.stateName;
  const userPhoneNumber = userOptions.userPhoneNumber;
  const messageHistory = userOptions.messageHistory;
  const lobbyParentMessageTs = userOptions.userInfo.lobby.parentMessageTs;
  const lobbyChannel = userOptions.userInfo.lobby.channel;

  // Create thread in state channel.
  SlackApiUtil.sendMessage(`Operator: New ${stateChannel} voter! (${userPhoneNumber}).`, {channel: stateChannel}).then(response => {
    const stateParentMessageTs = response.data.ts;

    // Populate state channel thread with message history so far.
    SlackApiUtil.sendMessages(messageHistory, {parentMessageTs: stateParentMessageTs,
                                               channel: stateChannel});

    const secondsSinceEpoch = Math.round(Date.now() / 1000);
    // Remember state channel thread identifying info.
    redisClient.setAsync(userPhoneNumber,
                        JSON.stringify({
                          lobby: {lobbyParentMessageTs, lobbyChannel},
                          stateChannel: {
                            parentMessageTs: stateParentMessageTs,
                            channel: response.data.channel,
                          },
                          lastVoterMessageSecsFromEpoch: secondsSinceEpoch,
                          stateName,
                        }));

    // Be able to identify phone number using state channel identifying info.
    redisClient.setAsync(`${response.data.channel}:${stateParentMessageTs}`,
                        JSON.stringify({userPhoneNumber}));
  });
}

exports.determineVoterState = (userOptions, redisClient) => {
  const messageHistory = userOptions.userInfo.messageHistory;
  const parentMessageTs = userOptions.userInfo.lobby.parentMessageTs;
  const channel = userOptions.userInfo.lobby.channel;
  const userPhoneNumber = userOptions.userPhoneNumber;
  const userMessage = userOptions.userMessage;

  messageHistory.push(`${userPhoneNumber}: ${userMessage}`);
  SlackApiUtil.sendMessage(`${userPhoneNumber}: ${userMessage}`, {parentMessageTs, channel}).then(response => {
      const stateName = MessageParserUtil.determineState(userMessage);
      if (stateName == null) {
        console.log("State not determined");
        TwilioApiUtil.sendMessage(MessageConstants.CLARIFY_STATE, {userPhoneNumber});
        SlackApiUtil.sendMessage(`EffingVote: ${MessageConstants.CLARIFY_STATE}`, {parentMessageTs, channel});
        messageHistory.push(`EffingVote: ${MessageConstants.CLARIFY_STATE}`);

        const secondsSinceEpoch = Math.round(Date.now() / 1000);
        redisClient.setAsync(userPhoneNumber,
                            JSON.stringify({
                              lobby: {parentMessageTs,
                                      channel: response.data.channel},
                              messageHistory,
                              lastVoterMessageSecsFromEpoch: secondsSinceEpoch,
                            }));
      } else {
        // Slack channel name must abide by this rule.
        const stateChannel = stateName.toLowerCase().replace(/\s/g, '-');
        TwilioApiUtil.sendMessage(MessageConstants.STATE_CONFIRMATION(stateName), {userPhoneNumber});
        SlackApiUtil.sendMessage(`Operator: Routing voter to ${stateChannel}.`, {parentMessageTs, channel});
        messageHistory.push(`EffingVote: ${MessageConstants.STATE_CONFIRMATION(stateName)}`);
        introduceVoterToStateChannel({stateChannel,
                                      userPhoneNumber,
                                      userInfo,
                                      messageHistory,
                                      stateName},
                                      redisClient);
      }
    });
}

exports.handleKnownStateVoter = (options, redisClient) => {
  SlackApiUtil.sendMessage(`${options.userPhoneNumber}: ${options.userMessage}`,
    {
      parentMessageTs: options.userInfo.stateChannel.parentMessageTs,
      channel: options.userInfo.stateChannel.channel,
    }).then(response => {
      const nowSecondsEpoch = Math.round(Date.now() / 1000);
      console.log(`Seconds since last message from voter: ${nowSecondsEpoch - options.userInfo.lastVoterMessageSecsFromEpoch}`);
      if (nowSecondsEpoch - options.userInfo.lastVoterMessageSecsFromEpoch > MINS_BEFORE_WELCOME_BACK_MESSAGE * 60) {
        const welcomeBackMessage = MessageConstants.WELCOME_BACK(options.userInfo.stateName);
        TwilioApiUtil.sendMessage(welcomeBackMessage, {userPhoneNumber: options.userPhoneNumber});
        SlackApiUtil.sendMessage(`EffingVote: ${welcomeBackMessage}`,
          {
            parentMessageTs: options.userInfo.stateChannel.parentMessageTs,
            channel: options.userInfo.stateChannel.channel,
          });
      }

      options.userInfo.lastVoterMessageSecsFromEpoch = nowSecondsEpoch;
      redisClient.setAsync(userPhoneNumber, JSON.stringify(options.userInfo));
    });
}
