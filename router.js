if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
  require('dotenv').config();
}

const MessageConstants = require('./message_constants');
const SlackApiUtil = require('./slack_api_util');
const SlackBlockUtil = require('./slack_block_util');
const TwilioApiUtil = require('./twilio_api_util');
const StateParser = require('./state_parser');
const DbApiUtil = require('./db_api_util');
const RedisApiUtil = require('./redis_api_util');
const LoadBalancer = require('./load_balancer');
const Hashes = require('jshashes'); // v1.0.5
const SlackMessageFormatter = require('./slack_message_formatter');
const CommandUtil = require('./command_util');
const MessageParser = require('./message_parser');
const SlackInteractionApiUtil = require('./slack_interaction_api_util');

const MINS_BEFORE_WELCOME_BACK_MESSAGE = 60;

const logDebug = process.env.NODE_ENV !== "test";

const introduceNewVoterToSlackChannel = ({userInfo, userMessage}, redisClient, twilioPhoneNumber, inboundDbMessageEntry, entryPoint, slackChannelName) => {
  if (logDebug) console.log("\nENTERING ROUTER.introduceNewVoterToSlackChannel");
  userInfo.lastVoterMessageSecsFromEpoch = Math.round(Date.now() / 1000);
  if (logDebug) console.log(`ROUTER.introduceNewVoterToSlackChannel: Updating lastVoterMessageSecsFromEpoch to ${userInfo.lastVoterMessageSecsFromEpoch}`);

  const welcomeMessage = MessageConstants.WELCOME_AND_DISCLAIMER();
  if (entryPoint === LoadBalancer.PULL_ENTRY_POINT) {
    if (logDebug) console.log(`ROUTER.introduceNewVoterToSlackChannel: Entry point is PULL, so sending automated welcome to voter.`);
    // Welcome the voter
    TwilioApiUtil.sendMessage(welcomeMessage, {userPhoneNumber: userInfo.userPhoneNumber, twilioPhoneNumber},
        DbApiUtil.populateAutomatedDbMessageEntry(userInfo)
      );
  }

  if (logDebug) console.log(`ROUTER.introduceNewVoterToSlackChannel: Announcing new voter via new thread in ${slackChannelName}.`);
  // In Slack, create entry channel message, followed by voter's message and intro text.
  const operatorMessage = `<!channel> New voter!\n*User ID:* ${userInfo.userId}\n*Connected via:* ${twilioPhoneNumber} (${entryPoint})`;

  const slackBlocks = SlackBlockUtil.getVoterStatusBlocks(operatorMessage);

  return SlackApiUtil.sendMessage(operatorMessage,
    {
      channel: slackChannelName,
      blocks: slackBlocks,
    }).then(response => {
      if (logDebug) console.log(`ROUTER.introduceNewVoterToSlackChannel: Successfully announced new voter via new thread in ${slackChannelName},
                    response.data.channel: ${response.data.channel},
                    response.data.ts: ${response.data.ts}`);

      // Remember the thread for this user and this channel,
      // using the ID version of the channel.
      userInfo[response.data.channel] = response.data.ts;

      // Set active channel to this first channel, since the voter is new.
      // Makes sure subsequent messages from the voter go to this channel, unless
      // this active channel is changed.
      userInfo.activeChannelId = response.data.channel;
      userInfo.activeChannelName = slackChannelName;

      // Depending on the entry point, either:
      // PULL: Pass user message to Slack and then automated reply.
      // PUSH: Pass automated broadcast message to Slack and then user reply.
      if (entryPoint === LoadBalancer.PULL_ENTRY_POINT) {
        // Pass the voter's message along to the initial Slack channel thread,
        // and show in the Slack  thread the welcome message the voter received
        // in response.
        if (logDebug) console.log(`ROUTER.introduceNewVoterToSlackChannel: Passing voter message to Slack, slackChannelName: ${slackChannelName}, parentMessageTs: ${response.data.channel}.`);
        SlackApiUtil.sendMessage(`*${userInfo.userId.substring(0,5)}:* ${userMessage}`,
          {parentMessageTs: response.data.ts, channel: response.data.channel}, inboundDbMessageEntry, userInfo).then(() => {
            if (logDebug) console.log(`ROUTER.introduceNewVoterToSlackChannel: Passing automated welcome message to Slack, slackChannelName: ${slackChannelName}, parentMessageTs: ${response.data.channel}.`);
            SlackApiUtil.sendMessage(`*Automated Message:* ${welcomeMessage}`,
              {parentMessageTs: response.data.ts, channel: response.data.channel});
          });
      } else if (entryPoint === LoadBalancer.PUSH_ENTRY_POINT) {
        if (logDebug) console.log(`ROUTER.introduceNewVoterToSlackChannel: Retrieving and passing initial push message to Slack, slackChannelName: ${slackChannelName}, parentMessageTs: ${response.data.channel}.`);
        const messageHistoryContextText = "Below is the voter's message history so far.";
        postUserMessageHistoryToSlack(userInfo.userId, "1990-01-01 10:00:00.000", messageHistoryContextText, {destinationSlackParentMessageTs: response.data.ts, destinationSlackChannelId: response.data.channel}).then(() => {
          if (logDebug) console.log(`ROUTER.introduceNewVoterToSlackChannel: Passing voter message to Slack, slackChannelName: ${slackChannelName}, parentMessageTs: ${response.data.channel}.`);
          SlackApiUtil.sendMessage(`*${userInfo.userId.substring(0,5)}:* ${userMessage}`,
            {parentMessageTs: response.data.ts, channel: response.data.channel}, inboundDbMessageEntry, userInfo);
        });
      }

      // Add key/value such that given a user phone number we can get the
      // Slack channel thread associated with that user.
      if (logDebug) console.log(`ROUTER.introduceNewVoterToSlackChannel: Writing updated userInfo to Redis.`);
      RedisApiUtil.setHash(redisClient, `${userInfo.userId}:${twilioPhoneNumber}`, userInfo);

      // Add key/value such that given Slack thread data we can get a
      // user phone number.
      if (logDebug) console.log(`ROUTER.introduceNewVoterToSlackChannel: Writing updated Slack-to-Twilio redisData to Redis.`);
      return RedisApiUtil.setHash(redisClient, `${response.data.channel}:${response.data.ts}`,
                          {userPhoneNumber: userInfo.userPhoneNumber, twilioPhoneNumber});
    }).catch(err => {
      if (logDebug) console.log('\x1b[41m%s\x1b[1m\x1b[0m', `ROUTER.introduceNewVoterToSlackChannel (${userInfo.userId}): ERROR sending first Slack message: ${err}`);
    });
};

exports.handleNewVoter = (userOptions, redisClient, twilioPhoneNumber, inboundDbMessageEntry, entryPoint) => {
  if (logDebug) console.log("\nENTERING ROUTER.handleNewVoter");
  const userMessage = userOptions.userMessage;
  const userInfo = {};
  userInfo.userId = userOptions.userId;
  // Necessary for admin controls, so userPhoneNumber can be found even though
  // admins specify only userId.
  userInfo.userPhoneNumber = userOptions.userPhoneNumber;

  // Not necessary except for DB logging purposes. The twilioPhoneNumber reveals
  // the entry point. But to log for automated messages and Slack-to-Twilio
  // messages, this is necessary.
  userInfo.entryPoint = entryPoint;

  if (entryPoint === LoadBalancer.PULL_ENTRY_POINT) {
    userInfo.isDemo = LoadBalancer.phoneNumbersAreDemo(twilioPhoneNumber, userInfo.userPhoneNumber);
    if (logDebug) console.log(`ROUTER.handleNewVoter (${userInfo.userId}): Evaluating isDemo based on userPhoneNumber/twilioPhoneNumber: ${userInfo.isDemo}`);
    userInfo.confirmedDisclaimer = false;
    userInfo.volunteerEngaged = false;
  }

  DbApiUtil.logVoterStatusToDb({
    userId: userInfo.userId,
    userPhoneNumber: userInfo.userPhoneNumber,
    twilioPhoneNumber,
    voterStatus: "UNKNOWN",
    originatingSlackUserName: null,
    originatingSlackUserId: null,
    originatingSlackChannelName: null,
    originatingSlackChannelId: null,
    originatingSlackParentMessageTs: null,
    isDemo: userInfo.isDemo,
  });

  let slackChannelName = "lobby";
  if (entryPoint === LoadBalancer.PULL_ENTRY_POINT) {
    if (userInfo.isDemo) {
      slackChannelName = "demo-lobby";
      if (logDebug) console.log(`ROUTER.handleNewVoter (${userInfo.userId}): New voter will enter Slack channel: ${slackChannelName}`);
    }
  } else if (entryPoint === LoadBalancer.PUSH_ENTRY_POINT) {
    userInfo.stateName = LoadBalancer.getPushPhoneNumberState(twilioPhoneNumber);
    if (logDebug) console.log(`ROUTER.handleNewVoter (${userInfo.userId}): Determined that twilioPhoneNumber ${twilioPhoneNumber} corresponds to U.S. state ${userInfo.stateName} based on hard coding in LoadBalancer.`);
    return LoadBalancer.selectSlackChannel(redisClient, LoadBalancer.PUSH_ENTRY_POINT, userInfo.stateName).then(selectedChannelName => {
      if (logDebug) console.log(`ROUTER.handleNewVoter (${userInfo.userId}): LoadBalancer returned Slack channel ${selectedChannelName} for new PUSH voter.`);
      if (selectedChannelName) {
        slackChannelName = selectedChannelName;
      } else {
        // If LoadBalancer didn't find a Slack channel, then  #lobby remains as fallback.
        if (logDebug) console.log('\x1b[41m%s\x1b[1m\x1b[0m', `ROUTER.handleNewVoter (${userInfo.userId}): ERROR LoadBalancer did not find a Slack channel for new PUSH voter. Using #lobby as fallback.`);
      }
      return introduceNewVoterToSlackChannel({userInfo, userMessage}, redisClient, twilioPhoneNumber, inboundDbMessageEntry, entryPoint, slackChannelName);
    }).catch(err => {
      if (logDebug) console.log('\x1b[41m%s\x1b[1m\x1b[0m', `ROUTER.handleNewVoter (${userInfo.userId}): ERROR in LoadBalancer.selectSlackChannel for new PUSH voter: ${err}`);
    });
  }

  return introduceNewVoterToSlackChannel({userInfo, userMessage}, redisClient, twilioPhoneNumber, inboundDbMessageEntry, entryPoint, slackChannelName);
};

const postUserMessageHistoryToSlack = (userId, timestampOfLastMessageInThread, messageHistoryContextText, {destinationSlackParentMessageTs, destinationSlackChannelId}) => {
  if (logDebug) console.log("\nENTERING ROUTER.postUserMessageHistoryToSlack");
  return DbApiUtil.getMessageHistoryFor(userId, timestampOfLastMessageInThread).then(messageHistory => {
    // Just in case.
    if (!messageHistory) {
      if (logDebug) console.log("ROUTER.postUserMessageHistoryToSlack: No message history found.");
      return;
    }
    if (logDebug) console.log("ROUTER.postUserMessageHistoryToSlack: Message history found, formatting it by calling SlackMessageFormatter.");
    const formattedMessageHistory = SlackMessageFormatter.formatMessageHistory(messageHistory, userId.substring(0,5));

    return SlackApiUtil.sendMessage(`*Operator:* ${messageHistoryContextText}\n\n${formattedMessageHistory}`,
                                      {parentMessageTs: destinationSlackParentMessageTs, channel: destinationSlackChannelId});
  }).catch((err) => {
    if (logDebug) console.log('\x1b[41m%s\x1b[1m\x1b[0m', "ROUTER.postUserMessageHistoryToSlack: ERROR fetching messageHistory of user from Postgres.", err);
  });
};

// This helper handles all tasks associated with routing a voter to a new
// channel that require the new channel's thread.
const routeVoterToSlackChannelHelper = (userInfo, redisClient, twilioPhoneNumber,
                                  {destinationSlackChannelName, destinationSlackChannelId, destinationSlackParentMessageTs},
                                  timestampOfLastMessageInThread) => {
  if (logDebug) console.log("\nENTERING ROUTER.routeVoterToSlackChannelHelper");
  if (logDebug) console.log(`ROUTER.routeVoterToSlackChannelHelper: Voter is being routed to,
                destinationSlackChannelId: ${destinationSlackChannelId},
                destinationSlackParentMessageTs: ${destinationSlackParentMessageTs},
                destinationSlackChannelName: ${destinationSlackChannelName}`);
  const userPhoneNumber = userInfo.userPhoneNumber;

  let messageHistoryContextText = "Below are our messages with the voter since they left this thread.";
  // If voter is new to a channel/thread, retrieve all message history. If a
  // voter is returning to a channel/thread, timestamp should be passed, used
  // to only retrieve messages since the voter left that thread.
  if (!timestampOfLastMessageInThread) {
    if (logDebug) console.log("ROUTER.routeVoterToSlackChannelHelper: Voter HAS been to this channel before.");
    // If timestamp isn't passed, voter is new to channel. Retrieve full message history.
    timestampOfLastMessageInThread = "1990-01-01 10:00:00.000";
    messageHistoryContextText = "Below is the voter's message history so far.";
  } else {
    if (logDebug) console.log("ROUTER.routeVoterToSlackChannelHelper: Voter HAS NOT been to this channel before.");
  }

  if (logDebug) console.log("ROUTER.routeVoterToSlackChannelHelper: Changing voter's active channel.");
  // Reassign the active channel so that the next voter messages go to the
  // new active channel.
  userInfo.activeChannelId = destinationSlackChannelId;
  userInfo.activeChannelName = destinationSlackChannelName;

  // Update userInfo in Redis (remember state channel thread identifying info and new activeChannel).
  if (logDebug) console.log(`ROUTER.routeVoterToSlackChannelHelper: Writing updated userInfo to Redis.`);
  RedisApiUtil.setHash(redisClient, `${userInfo.userId}:${twilioPhoneNumber}`, userInfo);

  // Populate state channel thread with message history so far.
  return postUserMessageHistoryToSlack(userInfo.userId, timestampOfLastMessageInThread, messageHistoryContextText,
                                          {destinationSlackParentMessageTs, destinationSlackChannelId});
};

// This function routes a voter to a new channel WHETHER OR NOT they have
// previously been to that channel before, creating a new thread if needed.
const routeVoterToSlackChannel = (userInfo, redisClient, {userId, twilioPhoneNumber, destinationSlackChannelName}, adminCommandParams /* only for admin re-routes (not automated)*/) => {
  if (logDebug) console.log("\nENTERING ROUTER.routeVoterToSlackChannel");
  const userPhoneNumber = userInfo.userPhoneNumber;

  // TODO: Consider doing this fetch within handleSlackAdminCommand, especially
  // when adding new commands that require fetching a Slack channel ID.
  return RedisApiUtil.getHash(redisClient, "slackPodChannelIds").then(slackChannelIds => {
    const destinationSlackChannelId = slackChannelIds[destinationSlackChannelName];
    if (logDebug) console.log(`ROUTER.routeVoterToSlackChannel: Determined destination Slack channel ID: ${destinationSlackChannelId}`);

    // Operations for successful ADMIN route of voter.
    if (adminCommandParams) {
      // Error catching for admin command: destination channel not found.
      if (!destinationSlackChannelId) {
        if (logDebug) console.log("ROUTER.routeVoterToSlackChannel: destinationSlackChannelId not found. Did you forget to add it to slackPodChannelIds in Redis? Or if this is an admin action, did the admin type it wrong?");
        return SlackApiUtil.sendMessage(`*Operator:* Slack channel ${destinationSlackChannelName} not found.`,
                                        {channel: process.env.ADMIN_CONTROL_ROOM_SLACK_CHANNEL_ID, parentMessageTs: adminCommandParams.commandParentMessageTs});
      }
      // TODO: This should probably be a lot later in the routing of the voter.
      if (logDebug) console.log("ROUTER.routeVoterToSlackChannel: Routing of voter should succeed from here on out. Letting the admin (if applicable) know.");
      SlackApiUtil.sendMessage(`*Operator:* Operation successful.`,
                                      {channel: process.env.ADMIN_CONTROL_ROOM_SLACK_CHANNEL_ID, parentMessageTs: adminCommandParams.commandParentMessageTs});
      SlackApiUtil.sendMessage(`*Operator:* Voter is being routed to *${destinationSlackChannelName}* by *${adminCommandParams.routingSlackUserName}*.`,
                                  {channel: userInfo.activeChannelId, parentMessageTs: userInfo[userInfo.activeChannelId]});
    // Operations for AUTOMATED route of voter.
    } else {
      SlackApiUtil.sendMessage(`*Operator:* Routing voter to *${destinationSlackChannelName}*.`,
                                  {channel: userInfo.activeChannelId, parentMessageTs: userInfo[userInfo.activeChannelId]});
    }

    // Remove the voter status panel from the old thread, in which the voter is no longer active.
    // Note: First we need to fetch the old thread parent message blocks, for both 1. the
    // text to be preserved when changing the parent message, and for 2. the other
    // blocks to be transferred to the new thread.
    return SlackApiUtil.fetchSlackMessageBlocks(userInfo.activeChannelId, userInfo[userInfo.activeChannelId]).then(previousParentMessageBlocks => {
      // return SlackBlockUtil.populateDropdownWithLatestVoterStatus(previousParentMessageBlocks, userId).then(() => {
        // make deep copy of previousParentMessageBlocks
        const closedVoterPanelMessage = `Voter has been routed to *${destinationSlackChannelName}*.`;
        const closedVoterPanelBlocks = SlackBlockUtil.makeClosedVoterPanelBlocks(closedVoterPanelMessage, false /* include undo button */);
        // Note: It's important not to modify previousParentMessageBlocks here because it may be used again below.
        // Its panel is modified in its origin and it's message is modified to move its panel to destination.
        const newPrevParentMessageBlocks = [previousParentMessageBlocks[0]].concat(closedVoterPanelBlocks);
        return SlackInteractionApiUtil.replaceSlackMessageBlocks({
            slackChannelId: userInfo.activeChannelId,
            slackParentMessageTs: userInfo[userInfo.activeChannelId],
            newBlocks: newPrevParentMessageBlocks,
          }).then(() => {
            if (logDebug) console.log("ROUTER.routeVoterToSlackChannel: Successfully updated old thread parent message during channel move");
            // If this user hasn't been to the destination channel, create new thread in the channel.
            if (!userInfo[destinationSlackChannelId]) {
              if (logDebug) console.log(`ROUTER.routeVoterToSlackChannel: Creating a new thread in this channel (${destinationSlackChannelId}), since voter hasn't been here.`);
              let newParentMessageText = `<!channel> New ${userInfo.stateName} voter!\n*User ID:* ${userId}\n*Connected via:* ${twilioPhoneNumber} (${userInfo.entryPoint})`;
              if (adminCommandParams) {
                newParentMessageText = `<!channel> Voter routed from *${adminCommandParams.previousSlackChannelName}* by *${adminCommandParams.routingSlackUserName}*\n*User ID:* ${userId}\n*Connected via:* ${twilioPhoneNumber} (${userInfo.entryPoint})`;
              }

              // Use the same blocks as from the voter's previous active thread parent message, except for the voter info text.
              if (previousParentMessageBlocks[0] && previousParentMessageBlocks[0].text) {
                previousParentMessageBlocks[0].text.text = newParentMessageText;
              } else {
                if (logDebug) console.log('\x1b[41m%s\x1b[1m\x1b[0m', "ROUTER.routeVoterToSlackChannel: ERROR replacing voter info text above voter panel blocks that are being moved.");
              }
              // TODO: Catch if this channel doesn't exist (should only be possible if Redis isn't kept up-to-date).
              // Consider fetching slackChannelIds from Slack instead.
              // Note: The parent message text is actually populated via the blocks.
              return SlackApiUtil.sendMessage(newParentMessageText,
                {
                  channel: destinationSlackChannelName,
                  blocks: previousParentMessageBlocks,
                }).then(response => {
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
                }).catch(err => {
                  if (logDebug) console.log('\x1b[41m%s\x1b[1m\x1b[0m', "ROUTER.routeVoterToSlackChannel: ERROR starting new thread in destination channel", err);
                });
            // If this user HAS been to the destination channel, use the same thread info.
            } else {
              // Fetch the blocks of the parent message of the destination thread to which the voter is returning.
              return SlackApiUtil.fetchSlackMessageBlocks(destinationSlackChannelId, userInfo[destinationSlackChannelId]).then(destinationParentMessageBlocks => {
                // Preserve the voter info message of the destination thread to which the voter is returning, but otherwise use the blocks of the previous thread in which the voter was active.
                if (previousParentMessageBlocks[0] && previousParentMessageBlocks[0].text) {
                  previousParentMessageBlocks[0].text.text = destinationParentMessageBlocks[0].text.text;
                } else {
                  if (logDebug) console.log('\x1b[41m%s\x1b[1m\x1b[0m', "ROUTER.routeVoterToSlackChannel: ERROR replacing voter info text above voter panel blocks that are being moved.");
                }
                return SlackInteractionApiUtil.replaceSlackMessageBlocks({
                  slackChannelId: destinationSlackChannelId,
                  slackParentMessageTs: userInfo[destinationSlackChannelId],
                  newBlocks: previousParentMessageBlocks,
                }).then(() => {
                  if (logDebug) console.log(`ROUTER.routeVoterToSlackChannel: Returning voter back to *${destinationSlackChannelName}* from *${adminCommandParams.previousSlackChannelName}*. Voter has been here before.`);
                  SlackApiUtil.sendMessage(`*Operator:* Voter *${userId}* was routed from *${adminCommandParams.previousSlackChannelName}* back to this channel by *${adminCommandParams.routingSlackUserName}*. See their thread with *${twilioPhoneNumber}* above.`,
                    {channel: destinationSlackChannelId});
                  return DbApiUtil.getTimestampOfLastMessageInThread(userInfo[destinationSlackChannelId]).then(timestampOfLastMessageInThread => {
                    if (logDebug) console.log(`timestampOfLastMessageInThread: ${timestampOfLastMessageInThread}`);
                    return SlackApiUtil.sendMessage(`*Operator:* Voter *${userId}* was routed from *${adminCommandParams.previousSlackChannelName}* back to this thread by *${adminCommandParams.routingSlackUserName}*. Messages sent here will again relay to the voter.`,
                      {channel: destinationSlackChannelId, parentMessageTs: userInfo[destinationSlackChannelId]}).then(() => {
                      return routeVoterToSlackChannelHelper(userInfo, redisClient, twilioPhoneNumber,
                                                      {destinationSlackChannelName, destinationSlackChannelId, destinationSlackParentMessageTs: userInfo[destinationSlackChannelId]},
                                                      timestampOfLastMessageInThread);
                    }).catch(err => {
                      if (logDebug) console.log('\x1b[41m%s\x1b[1m\x1b[0m', "ROUTER.routeVoterToSlackChannel: ERROR sending voter back to channel", err);
                    });
                  }).catch(err => {
                    if (logDebug) console.log('\x1b[41m%s\x1b[1m\x1b[0m', "ROUTER.routeVoterToSlackChannel: ERROR in DbApiUtil.getTimestampOfLastMessageInThread", err);
                  });
                }).catch(err => {
                  if (logDebug) console.log('\x1b[41m%s\x1b[1m\x1b[0m', "ROUTER.routeVoterToSlackChannel: ERROR updating thread parent message during channel move back to thread: ", err);
                });
              }).catch(err => {
                if (logDebug) console.log('\x1b[41m%s\x1b[1m\x1b[0m', "ROUTER.routeVoterToSlackChannel: ERROR retrieving parent message thread when returning to thread: ", err);
              });
            }
          }).catch(err => {
            if (logDebug) console.log('\x1b[41m%s\x1b[1m\x1b[0m', "ROUTER.routeVoterToSlackChannel: ERROR updating old thread parent message during channel move: ", err);
          });
      // }).catch(err => {
      //   if (logDebug) console.log('\x1b[41m%s\x1b[1m\x1b[0m', "ROUTER.routeVoterToSlackChannel: ERROR retrieving previous active thread parent message text: ", err);
      // });
    }).catch(err => {
      if (logDebug) console.log('\x1b[41m%s\x1b[1m\x1b[0m', "ROUTER.routeVoterToSlackChannel: ERROR retrieving lastest voter status:", err);
    });
  }).catch(err => {
    if (logDebug) console.log('\x1b[41m%s\x1b[1m\x1b[0m', "ROUTER.routeVoterToSlackChannel: ERROR retrieving slackPodChannelIds key from Redis! This must be manually added!", err);
  });
};

exports.determineVoterState = (userOptions, redisClient, twilioPhoneNumber, inboundDbMessageEntry) => {
  if (logDebug) console.log("\nENTERING ROUTER.determineVoterState");
  const userInfo = userOptions.userInfo;
  const userPhoneNumber = userOptions.userPhoneNumber;
  const userId = userInfo.userId;
  const userMessage = userOptions.userMessage;

  userInfo.lastVoterMessageSecsFromEpoch = Math.round(Date.now() / 1000);
  if (logDebug) console.log(`ROUTER.determineVoterState: Updating lastVoterMessageSecsFromEpoch to ${userInfo.lastVoterMessageSecsFromEpoch}`);

  const lobbyChannelId = userInfo.activeChannelId;
  const lobbyParentMessageTs = userInfo[lobbyChannelId];

  if (logDebug) console.log(`ROUTER.determineVoterState: Passing voter message to Slack, slackChannelName: ${lobbyChannelId}, parentMessageTs: ${lobbyParentMessageTs}.`);
  return SlackApiUtil.sendMessage(`*${userId.substring(0,5)}:* ${userMessage}`, {
    parentMessageTs: lobbyParentMessageTs,
    channel: lobbyChannelId},
    inboundDbMessageEntry, userInfo).then(response => {
      const stateName = StateParser.determineState(userMessage);
      if (stateName == null) {
        if (logDebug) console.log(`ROUTER.determineVoterState: StateParser could not determine U.S. state of voter from message ${userMessage}`);
        TwilioApiUtil.sendMessage(MessageConstants.CLARIFY_STATE(), {userPhoneNumber, twilioPhoneNumber},
          DbApiUtil.populateAutomatedDbMessageEntry(userInfo)
        );
        SlackApiUtil.sendMessage(`*Automated Message:* ${MessageConstants.CLARIFY_STATE()}`,
          {parentMessageTs: lobbyParentMessageTs, channel: lobbyChannelId});

        if (logDebug) console.log(`ROUTER.determineVoterState: Writing updated userInfo to Redis.`);
        return RedisApiUtil.setHash(redisClient, `${userId}:${twilioPhoneNumber}`, userInfo);
      } else {
        // This is used for display as well as to know later that the voter's
        // U.S. state has been determined.
        userInfo.stateName = stateName;
        if (logDebug) console.log(`ROUTER.determineVoterState: StateParser reviewed ${userMessage} and determined U.S. state: ${stateName}`);

        TwilioApiUtil.sendMessage(MessageConstants.STATE_CONFIRMATION(stateName), {userPhoneNumber, twilioPhoneNumber},
          DbApiUtil.populateAutomatedDbMessageEntry(userInfo)
        );

        // Slack channel name must abide by the rules in this function.
        return LoadBalancer.selectSlackChannel(redisClient, LoadBalancer.PULL_ENTRY_POINT, stateName, userInfo.isDemo).then(selectedStateChannelName => {
          return SlackApiUtil.sendMessage(`*Automated Message:* ${MessageConstants.STATE_CONFIRMATION(stateName)}`,
                                    {parentMessageTs: lobbyParentMessageTs, channel: lobbyChannelId}).then(() => {
            if (!selectedStateChannelName) {
              if (logDebug) console.log('\x1b[41m%s\x1b[1m\x1b[0m', `ROUTER.determineVoterState: ERROR in selecting U.S. state channel. Defaulting to #lobby.`);
              if (logDebug) console.log('\x1b[41m%s\x1b[1m\x1b[0m', 'I am bright red');
              selectedStateChannelName = "#lobby";
            } else {
              if (logDebug) console.log(`ROUTER.determineVoterState: U.S. state channel successfully selected: ${selectedStateChannelName}`);
            }
            return routeVoterToSlackChannel(userInfo, redisClient, {userId, twilioPhoneNumber, destinationSlackChannelName: selectedStateChannelName});
          });
        }).catch(err => {
          if (logDebug) console.log('\x1b[41m%s\x1b[1m\x1b[0m', `ROUTER.determineVoterState (${userInfo.userId}): ERROR in LoadBalancer.selectSlackChannel for PULL voter: ${err}`);
        });
      }
    });
};

exports.handleDisclaimer = (userOptions, redisClient, twilioPhoneNumber, inboundDbMessageEntry) => {
  if (logDebug) console.log("\nENTERING ROUTER.handleDisclaimer");
  const userInfo = userOptions.userInfo;
  const userId = userInfo.userId;
  const userMessage = userOptions.userMessage;
  const slackLobbyMessageParams = {
      parentMessageTs: userInfo[userInfo.activeChannelId],
      channel: userInfo.activeChannelId,
    };

  if (logDebug) console.log(`ROUTER.handleDisclaimer: Updating lastVoterMessageSecsFromEpoch to ${userInfo.lastVoterMessageSecsFromEpoch}`);
  userInfo.lastVoterMessageSecsFromEpoch = Math.round(Date.now() / 1000);

  SlackApiUtil.sendMessage(`*${userId.substring(0,5)}:* ${userMessage}`, slackLobbyMessageParams, inboundDbMessageEntry, userInfo).then(response => {
      const userMessageNoPunctuation = userOptions.userMessage.replace(/[.,?\/#!$%\^&\*;:{}=\-_`~()]/g, '');
      const cleared = userMessageNoPunctuation.toLowerCase().trim() == "agree";
      let automatedMessage;
      if (cleared) {
        if (logDebug) console.log(`ROUTER.handleDisclaimer: Voter cleared disclaimer with message ${userMessage}.`);
        userInfo.confirmedDisclaimer = true;
        automatedMessage = MessageConstants.DISCLAIMER_CONFIRMATION_AND_STATE_QUESTION();
      } else {
        if (logDebug) console.log(`ROUTER.handleDisclaimer: Voter did not clear disclaimer with message ${userMessage}.`);
        automatedMessage = MessageConstants.CLARIFY_DISCLAIMER();
      }
      RedisApiUtil.setHash(redisClient, `${userId}:${twilioPhoneNumber}`, userInfo);
      TwilioApiUtil.sendMessage(automatedMessage, {userPhoneNumber: userOptions.userPhoneNumber, twilioPhoneNumber},
        DbApiUtil.populateAutomatedDbMessageEntry(userInfo)
      );
      SlackApiUtil.sendMessage(`*Automated Message:* ${automatedMessage}`, slackLobbyMessageParams);
    });
};

exports.handleClearedVoter = (userOptions, redisClient, twilioPhoneNumber, inboundDbMessageEntry) => {
  if (logDebug) console.log("\nENTERING ROUTER.handleClearedVoter");
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
      if (logDebug) console.log(`ROUTER.handleClearedVoter: Seconds since last message from voter: ${nowSecondsEpoch - lastVoterMessageSecsFromEpoch}`);

      if (nowSecondsEpoch - lastVoterMessageSecsFromEpoch > MINS_BEFORE_WELCOME_BACK_MESSAGE * 60) {
        if (logDebug) console.log(`ROUTER.handleClearedVoter: Seconds since last message from voter > MINS_BEFORE_WELCOME_BACK_MESSAGE (${nowSecondsEpoch - lastVoterMessageSecsFromEpoch} > : ${MINS_BEFORE_WELCOME_BACK_MESSAGE}), sending welcome back message.`);
        const welcomeBackMessage = MessageConstants.WELCOME_BACK();
        TwilioApiUtil.sendMessage(welcomeBackMessage, {userPhoneNumber: userOptions.userPhoneNumber, twilioPhoneNumber});
        SlackApiUtil.sendMessage(`*Automated Message:* ${welcomeBackMessage}`, activeChannelMessageParams);
      }

      if (logDebug) console.log(`ROUTER.handleClearedVoter: Writing updated userInfo to Redis.`);
      return RedisApiUtil.setHash(redisClient, `${userId}:${twilioPhoneNumber}`, userInfo);
    });
};

exports.handleSlackVoterThreadMessage = (req, redisClient, redisData, originatingSlackUserName) => {
  if (logDebug) console.log("\nENTERING ROUTER.handleSlackVoterThreadMessage");
  const reqBody = req.body;

  const userPhoneNumber = redisData.userPhoneNumber;
  const twilioPhoneNumber = redisData.twilioPhoneNumber;
  if (userPhoneNumber) {
    if (logDebug) console.log(`ROUTER.handleSlackVoterThreadMessage: Successfully determined userPhoneNumber from Redis`);
    const unprocessedSlackMessage = reqBody.event.text;
    if (logDebug) console.log(`Received message from Slack: ${unprocessedSlackMessage}`);

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
          if (logDebug) console.log("Router: volunteer engaged, suppressing automated system.")
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
        SlackApiUtil.sendMessage(`*Operator:* Your message was not relayed, as this thread is inactive. The voter's active thread is in ${userInfo.activeChannelName}.`,
                                      {channel: reqBody.event.channel, parentMessageTs: reqBody.event.thread_ts});
      }
    });
  }
};

exports.handleSlackAdminCommand = (reqBody, redisClient, originatingSlackUserName) => {
  if (logDebug) console.log("\n ENTERING ROUTER.handleSlackAdminCommand");
  const adminCommandArgs = CommandUtil.parseSlackCommand(reqBody.event.text);
  if (logDebug) console.log(`ROUTER.handleSlackAdminCommand: Parsed admin control command params: ${JSON.stringify(adminCommandArgs)}`);
  if (adminCommandArgs) {

    switch (adminCommandArgs.command) {
      case CommandUtil.ROUTE_VOTER:
        // TODO: Move some of this logic to CommandUtil, so this swith statement
        // is cleaner.
        const redisHashKey = `${adminCommandArgs.userId}:${adminCommandArgs.twilioPhoneNumber}`;
        if (logDebug) console.log(`ROUTER.handleSlackAdminCommand: Looking up ${redisHashKey} in Redis.`);
        RedisApiUtil.getHash(redisClient, redisHashKey).then(userInfo => {
          // This catches invalid userPhoneNumber:twilioPhoneNumber pairs.
          if (!userInfo) {
            if (logDebug) console.log("Router.handleSlackAdminCommand: No Redis data found for userId:twilioPhoneNumber pair.");
            SlackApiUtil.sendMessage(`*Operator:* No record found for user ID (${adminCommandArgs.userId}) and/or Twilio phone number (${adminCommandArgs.twilioPhoneNumber}).`,
                                            {channel: process.env.ADMIN_CONTROL_ROOM_SLACK_CHANNEL_ID, parentMessageTs: reqBody.event.ts});
          // userPhoneNumber:twilioPhoneNumber pair found successfully.
          } else {
            // Voter already in destination slack channel (error).
            if (userInfo.activeChannelName === adminCommandArgs.destinationSlackChannelName) {
              if (logDebug) console.log("Router.handleSlackAdminCommand: Voter is already active in destination Slack channel.");
              SlackApiUtil.sendMessage(`*Operator:* Voter's thread in ${userInfo.activeChannelName} is already the active thread.`,
                                              {channel: process.env.ADMIN_CONTROL_ROOM_SLACK_CHANNEL_ID, parentMessageTs: reqBody.event.ts});
            } else {
              const adminCommandParams = {
                commandParentMessageTs: reqBody.event.ts,
                previousSlackChannelName: userInfo.activeChannelName,
                routingSlackUserName: originatingSlackUserName,
              };
              if (logDebug) console.log(`Router.handleSlackAdminCommand: Routing voter from ${userInfo.activeChannelName} to ${adminCommandArgs.destinationSlackChannelName}.`);
              routeVoterToSlackChannel(userInfo, redisClient, adminCommandArgs, adminCommandParams);
            }
          }
        }).catch(err => {
          if (logDebug) console.log(`ROUTER.handleSlackAdminCommand: Did not find userInfo in Redis for key ${redisHashKey}`);
        });
        return;
      case CommandUtil.FIND_VOTER:
        CommandUtil.findVoter(redisClient, adminCommandArgs.voterIdentifier);
        return;
      case CommandUtil.RESET_VOTER:
        CommandUtil.resetVoter(redisClient, adminCommandArgs.userId, adminCommandArgs.twilioPhoneNumber);
        return;
      default:
        console.log(`ROUTER.handleSlackAdminCommand: Unknown Slack admin command`);
        return;
    }
  } else {
    SlackApiUtil.sendMessage(`*Operator:* Your command could not be parsed (did you closely follow the required format)?`,
                                    {channel: process.env.ADMIN_CONTROL_ROOM_SLACK_CHANNEL_ID, parentMessageTs: reqBody.event.ts});
  }
};
