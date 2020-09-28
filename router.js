const Sentry = require('@sentry/node');

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
const logger = require('./logger');

const MINS_BEFORE_WELCOME_BACK_MESSAGE = 60;

const introduceNewVoterToSlackChannel = async ({userInfo, userMessage}, redisClient, twilioPhoneNumber, inboundDbMessageEntry, entryPoint, slackChannelName) => {
  logger.debug("ENTERING ROUTER.introduceNewVoterToSlackChannel");
  userInfo.lastVoterMessageSecsFromEpoch = Math.round(Date.now() / 1000);
  logger.debug(`ROUTER.introduceNewVoterToSlackChannel: Updating lastVoterMessageSecsFromEpoch to ${userInfo.lastVoterMessageSecsFromEpoch}`);

  const welcomeMessage = MessageConstants.WELCOME_AND_DISCLAIMER();
  if (entryPoint === LoadBalancer.PULL_ENTRY_POINT) {
    logger.debug(`ROUTER.introduceNewVoterToSlackChannel: Entry point is PULL, so sending automated welcome to voter.`);
    // Welcome the voter
    await TwilioApiUtil.sendMessage(
      welcomeMessage,
      {userPhoneNumber: userInfo.userPhoneNumber, twilioPhoneNumber},
      await DbApiUtil.populateAutomatedDbMessageEntry(userInfo)
    );
  }

  logger.debug(`ROUTER.introduceNewVoterToSlackChannel: Announcing new voter via new thread in ${slackChannelName}.`);
  // In Slack, create entry channel message, followed by voter's message and intro text.
  const operatorMessage = `<!channel> New voter!\n*User ID:* ${userInfo.userId}\n*Connected via:* ${twilioPhoneNumber} (${entryPoint})`;

  const slackBlocks = SlackBlockUtil.getVoterStatusBlocks(operatorMessage);

  const response = await SlackApiUtil.sendMessage(
    operatorMessage,
    {
      channel: slackChannelName,
      blocks: slackBlocks,
    }
  );

  logger.debug(`ROUTER.introduceNewVoterToSlackChannel: Successfully announced new voter via new thread in ${slackChannelName},
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
    logger.debug(`ROUTER.introduceNewVoterToSlackChannel: Passing voter message to Slack, slackChannelName: ${slackChannelName}, parentMessageTs: ${response.data.channel}.`);
    await SlackApiUtil.sendMessage(
      `*${userInfo.userId.substring(0,5)}:* ${userMessage}`,
      {parentMessageTs: response.data.ts, channel: response.data.channel},
      inboundDbMessageEntry,
      userInfo
    )

    logger.debug(`ROUTER.introduceNewVoterToSlackChannel: Passing automated welcome message to Slack, slackChannelName: ${slackChannelName}, parentMessageTs: ${response.data.channel}.`);
    await SlackApiUtil.sendMessage(
      `*Automated Message:* ${welcomeMessage}`,
      {parentMessageTs: response.data.ts, channel: response.data.channel}
    );
  } else if (entryPoint === LoadBalancer.PUSH_ENTRY_POINT) {
    logger.debug(`ROUTER.introduceNewVoterToSlackChannel: Retrieving and passing initial push message to Slack, slackChannelName: ${slackChannelName}, parentMessageTs: ${response.data.channel}.`);
    const messageHistoryContextText = "Below is the voter's message history so far.";
    await postUserMessageHistoryToSlack(
      userInfo.userId,
      "1990-01-01 10:00:00.000",
      messageHistoryContextText,
      {destinationSlackParentMessageTs: response.data.ts, destinationSlackChannelId: response.data.channel}
    );

    logger.debug(`ROUTER.introduceNewVoterToSlackChannel: Passing voter message to Slack, slackChannelName: ${slackChannelName}, parentMessageTs: ${response.data.channel}.`);

    await SlackApiUtil.sendMessage(
      `*${userInfo.userId.substring(0,5)}:* ${userMessage}`,
      {parentMessageTs: response.data.ts, channel: response.data.channel},
      inboundDbMessageEntry,
      userInfo,
    );
  }

  // Add key/value such that given a user phone number we can get the
  // Slack channel thread associated with that user.
  logger.debug(`ROUTER.introduceNewVoterToSlackChannel: Writing updated userInfo to Redis.`);
  await RedisApiUtil.setHash(redisClient, `${userInfo.userId}:${twilioPhoneNumber}`, userInfo);

  // Add key/value such that given Slack thread data we can get a
  // user phone number.
  logger.debug(`ROUTER.introduceNewVoterToSlackChannel: Writing updated Slack-to-Twilio redisData to Redis.`);
  await RedisApiUtil.setHash(redisClient, `${response.data.channel}:${response.data.ts}`,
                      {userPhoneNumber: userInfo.userPhoneNumber, twilioPhoneNumber});
};

exports.handleNewVoter = async (userOptions, redisClient, twilioPhoneNumber, inboundDbMessageEntry, entryPoint) => {
  logger.debug("ENTERING ROUTER.handleNewVoter");
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
    logger.debug(`ROUTER.handleNewVoter (${userInfo.userId}): Evaluating isDemo based on userPhoneNumber/twilioPhoneNumber: ${userInfo.isDemo}`);
    userInfo.confirmedDisclaimer = false;
    userInfo.volunteerEngaged = false;
  }

  await DbApiUtil.logVoterStatusToDb({
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
      logger.debug(`ROUTER.handleNewVoter (${userInfo.userId}): New voter will enter Slack channel: ${slackChannelName}`);
    }
  } else if (entryPoint === LoadBalancer.PUSH_ENTRY_POINT) {
    userInfo.stateName = LoadBalancer.getPushPhoneNumberState(twilioPhoneNumber);
    logger.debug(`ROUTER.handleNewVoter (${userInfo.userId}): Determined that twilioPhoneNumber ${twilioPhoneNumber} corresponds to U.S. state ${userInfo.stateName} based on hard coding in LoadBalancer.`);
    const selectedChannelName = await LoadBalancer.selectSlackChannel(redisClient, LoadBalancer.PUSH_ENTRY_POINT, userInfo.stateName);

    logger.debug(`ROUTER.handleNewVoter (${userInfo.userId}): LoadBalancer returned Slack channel ${selectedChannelName} for new PUSH voter.`);
    if (selectedChannelName) {
      slackChannelName = selectedChannelName;
    } else {
      // If LoadBalancer didn't find a Slack channel, then  #lobby remains as fallback.
      logger.error(`ROUTER.handleNewVoter (${userInfo.userId}): ERROR LoadBalancer did not find a Slack channel for new PUSH voter. Using #lobby as fallback.`);
    }
  }

  await introduceNewVoterToSlackChannel({userInfo, userMessage}, redisClient, twilioPhoneNumber, inboundDbMessageEntry, entryPoint, slackChannelName);
};

const postUserMessageHistoryToSlack = async (userId, timestampOfLastMessageInThread, messageHistoryContextText, {destinationSlackParentMessageTs, destinationSlackChannelId}) => {
  logger.debug("ENTERING ROUTER.postUserMessageHistoryToSlack");
  const messageHistory = await DbApiUtil.getMessageHistoryFor(userId, timestampOfLastMessageInThread);

  // Just in case.
  if (!messageHistory) {
    logger.debug("ROUTER.postUserMessageHistoryToSlack: No message history found.");
    return;
  }

  logger.debug("ROUTER.postUserMessageHistoryToSlack: Message history found, formatting it by calling SlackMessageFormatter.");
  const formattedMessageHistory = SlackMessageFormatter.formatMessageHistory(messageHistory, userId.substring(0,5));

  await SlackApiUtil.sendMessage(
    `*Operator:* ${messageHistoryContextText}\n\n${formattedMessageHistory}`,
    {parentMessageTs: destinationSlackParentMessageTs, channel: destinationSlackChannelId},
  );
};

// This helper handles all tasks associated with routing a voter to a new
// channel that require the new channel's thread.
const routeVoterToSlackChannelHelper = async (userInfo, redisClient, twilioPhoneNumber,
                                  {destinationSlackChannelName, destinationSlackChannelId, destinationSlackParentMessageTs},
                                  timestampOfLastMessageInThread) => {
  logger.debug("ENTERING ROUTER.routeVoterToSlackChannelHelper");
  logger.debug(`ROUTER.routeVoterToSlackChannelHelper: Voter is being routed to,
                destinationSlackChannelId: ${destinationSlackChannelId},
                destinationSlackParentMessageTs: ${destinationSlackParentMessageTs},
                destinationSlackChannelName: ${destinationSlackChannelName}`);
  const userPhoneNumber = userInfo.userPhoneNumber;

  let messageHistoryContextText = "Below are our messages with the voter since they left this thread.";
  // If voter is new to a channel/thread, retrieve all message history. If a
  // voter is returning to a channel/thread, timestamp should be passed, used
  // to only retrieve messages since the voter left that thread.
  if (!timestampOfLastMessageInThread) {
    logger.debug("ROUTER.routeVoterToSlackChannelHelper: Voter HAS been to this channel before.");
    // If timestamp isn't passed, voter is new to channel. Retrieve full message history.
    timestampOfLastMessageInThread = "1990-01-01 10:00:00.000";
    messageHistoryContextText = "Below is the voter's message history so far.";
  } else {
    logger.debug("ROUTER.routeVoterToSlackChannelHelper: Voter HAS NOT been to this channel before.");
  }

  logger.debug("ROUTER.routeVoterToSlackChannelHelper: Changing voter's active channel.");
  // Reassign the active channel so that the next voter messages go to the
  // new active channel.
  userInfo.activeChannelId = destinationSlackChannelId;
  userInfo.activeChannelName = destinationSlackChannelName;

  // Update userInfo in Redis (remember state channel thread identifying info and new activeChannel).
  logger.debug(`ROUTER.routeVoterToSlackChannelHelper: Writing updated userInfo to Redis.`);

  await RedisApiUtil.setHash(redisClient, `${userInfo.userId}:${twilioPhoneNumber}`, userInfo);

  // Populate state channel thread with message history so far.
  await postUserMessageHistoryToSlack(userInfo.userId, timestampOfLastMessageInThread, messageHistoryContextText,
                                          {destinationSlackParentMessageTs, destinationSlackChannelId});
};

// This function routes a voter to a new channel WHETHER OR NOT they have
// previously been to that channel before, creating a new thread if needed.
const routeVoterToSlackChannel = async (userInfo, redisClient, {userId, twilioPhoneNumber, destinationSlackChannelName}, adminCommandParams /* only for admin re-routes (not automated)*/) => {
  logger.debug("ENTERING ROUTER.routeVoterToSlackChannel");
  const userPhoneNumber = userInfo.userPhoneNumber;

  // TODO: Consider doing this fetch within handleSlackAdminCommand, especially
  // when adding new commands that require fetching a Slack channel ID.
  const slackChannelIds = await RedisApiUtil.getHash(redisClient, "slackPodChannelIds");
  const destinationSlackChannelId = slackChannelIds[destinationSlackChannelName];
  logger.debug(`ROUTER.routeVoterToSlackChannel: Determined destination Slack channel ID: ${destinationSlackChannelId}`);

  // Operations for successful ADMIN route of voter.
  if (adminCommandParams) {
    // Error catching for admin command: destination channel not found.
    if (!destinationSlackChannelId) {
      logger.debug("ROUTER.routeVoterToSlackChannel: destinationSlackChannelId not found. Did you forget to add it to slackPodChannelIds in Redis? Or if this is an admin action, did the admin type it wrong?");
      await SlackApiUtil.sendMessage(
        `*Operator:* Slack channel ${destinationSlackChannelName} not found.`,
        {channel: process.env.ADMIN_CONTROL_ROOM_SLACK_CHANNEL_ID, parentMessageTs: adminCommandParams.commandParentMessageTs}
      );
      return;
    }

    // TODO: This should probably be a lot later in the routing of the voter.
    logger.debug("ROUTER.routeVoterToSlackChannel: Routing of voter should succeed from here on out. Letting the admin (if applicable) know.");
    await SlackApiUtil.sendMessage(
      `*Operator:* Operation successful.`,
      {channel: process.env.ADMIN_CONTROL_ROOM_SLACK_CHANNEL_ID, parentMessageTs: adminCommandParams.commandParentMessageTs}
    );
    await SlackApiUtil.sendMessage(
      `*Operator:* Voter is being routed to *${destinationSlackChannelName}* by *${adminCommandParams.routingSlackUserName}*.`,
      {channel: userInfo.activeChannelId, parentMessageTs: userInfo[userInfo.activeChannelId]}
    );
  // Operations for AUTOMATED route of voter.
  } else {
    SlackApiUtil.sendMessage(
      `*Operator:* Routing voter to *${destinationSlackChannelName}*.`,
      {channel: userInfo.activeChannelId, parentMessageTs: userInfo[userInfo.activeChannelId]}
    );
  }

  // Remove the voter status panel from the old thread, in which the voter is no longer active.
  // Note: First we need to fetch the old thread parent message blocks, for both 1. the
  // text to be preserved when changing the parent message, and for 2. the other
  // blocks to be transferred to the new thread.
  const previousParentMessageBlocks = await SlackApiUtil.fetchSlackMessageBlocks(userInfo.activeChannelId, userInfo[userInfo.activeChannelId]);

  // return SlackBlockUtil.populateDropdownWithLatestVoterStatus(previousParentMessageBlocks, userId).then(() => {
  // make deep copy of previousParentMessageBlocks
  const closedVoterPanelMessage = `Voter has been routed to *${destinationSlackChannelName}*.`;
  const closedVoterPanelBlocks = SlackBlockUtil.makeClosedVoterPanelBlocks(closedVoterPanelMessage, false /* include undo button */);

  // Note: It's important not to modify previousParentMessageBlocks here because it may be used again below.
  // Its panel is modified in its origin and it's message is modified to move its panel to destination.
  const newPrevParentMessageBlocks = [previousParentMessageBlocks[0]].concat(closedVoterPanelBlocks);

  await SlackInteractionApiUtil.replaceSlackMessageBlocks({
    slackChannelId: userInfo.activeChannelId,
    slackParentMessageTs: userInfo[userInfo.activeChannelId],
    newBlocks: newPrevParentMessageBlocks,
  });

  logger.debug("ROUTER.routeVoterToSlackChannel: Successfully updated old thread parent message during channel move");

  // If this user hasn't been to the destination channel, create new thread in the channel.
  if (!userInfo[destinationSlackChannelId]) {
    logger.debug(`ROUTER.routeVoterToSlackChannel: Creating a new thread in this channel (${destinationSlackChannelId}), since voter hasn't been here.`);
    let newParentMessageText = `<!channel> New ${userInfo.stateName} voter!\n*User ID:* ${userId}\n*Connected via:* ${twilioPhoneNumber} (${userInfo.entryPoint})`;
    if (adminCommandParams) {
      newParentMessageText = `<!channel> Voter routed from *${adminCommandParams.previousSlackChannelName}* by *${adminCommandParams.routingSlackUserName}*\n*User ID:* ${userId}\n*Connected via:* ${twilioPhoneNumber} (${userInfo.entryPoint})`;
    }

    // Use the same blocks as from the voter's previous active thread parent message, except for the voter info text.
    if (previousParentMessageBlocks[0] && previousParentMessageBlocks[0].text) {
      previousParentMessageBlocks[0].text.text = newParentMessageText;
    } else {
      logger.error("ROUTER.routeVoterToSlackChannel: ERROR replacing voter info text above voter panel blocks that are being moved.");
    }
    // TODO: Catch if this channel doesn't exist (should only be possible if Redis isn't kept up-to-date).
    // Consider fetching slackChannelIds from Slack instead.
    // Note: The parent message text is actually populated via the blocks.
    const response = await SlackApiUtil.sendMessage(
      newParentMessageText,
      {
        channel: destinationSlackChannelName,
        blocks: previousParentMessageBlocks,
      }
    );

    // Remember the voter's thread in this channel.
    userInfo[response.data.channel] = response.data.ts;

    // Be able to identify phone number using NEW Slack channel identifying info.
    await RedisApiUtil.setHash(
      redisClient,
      `${response.data.channel}:${response.data.ts}`,
      {userPhoneNumber, twilioPhoneNumber}
    );

    // The logic above this is for a voter's first time at a channel (e.g. create thread).
    // This function is separated so that it could be used to return a voter to
    // their thread in a channel they've already been in.
    await routeVoterToSlackChannelHelper(
      userInfo, redisClient, twilioPhoneNumber,
      {destinationSlackChannelName, destinationSlackChannelId: response.data.channel, destinationSlackParentMessageTs: response.data.ts}
    );

    return;
  }
  // If this user HAS been to the destination channel, use the same thread info.

  // Fetch the blocks of the parent message of the destination thread to which the voter is returning.
  const destinationParentMessageBlocks = await SlackApiUtil.fetchSlackMessageBlocks(
    destinationSlackChannelId,
    userInfo[destinationSlackChannelId]
  )

  // Preserve the voter info message of the destination thread to which the voter is returning, but otherwise use the blocks of the previous thread in which the voter was active.
  if (previousParentMessageBlocks[0] && previousParentMessageBlocks[0].text) {
    previousParentMessageBlocks[0].text.text = destinationParentMessageBlocks[0].text.text;
  } else {
    logger.error("ROUTER.routeVoterToSlackChannel: ERROR replacing voter info text above voter panel blocks that are being moved.");
  }

  await SlackInteractionApiUtil.replaceSlackMessageBlocks({
    slackChannelId: destinationSlackChannelId,
    slackParentMessageTs: userInfo[destinationSlackChannelId],
    newBlocks: previousParentMessageBlocks,
  });

  logger.debug(`ROUTER.routeVoterToSlackChannel: Returning voter back to *${destinationSlackChannelName}* from *${adminCommandParams.previousSlackChannelName}*. Voter has been here before.`);

  await SlackApiUtil.sendMessage(
    `*Operator:* Voter *${userId}* was routed from *${adminCommandParams.previousSlackChannelName}* back to this channel by *${adminCommandParams.routingSlackUserName}*. See their thread with *${twilioPhoneNumber}* above.`,
    {channel: destinationSlackChannelId}
  );

  const timestampOfLastMessageInThread = DbApiUtil.getTimestampOfLastMessageInThread(userInfo[destinationSlackChannelId]);

  logger.debug(`timestampOfLastMessageInThread: ${timestampOfLastMessageInThread}`);

  await SlackApiUtil.sendMessage(
    `*Operator:* Voter *${userId}* was routed from *${adminCommandParams.previousSlackChannelName}* back to this thread by *${adminCommandParams.routingSlackUserName}*. Messages sent here will again relay to the voter.`,
    {channel: destinationSlackChannelId, parentMessageTs: userInfo[destinationSlackChannelId]}
  );

  await routeVoterToSlackChannelHelper(
    userInfo, redisClient, twilioPhoneNumber,
    {destinationSlackChannelName, destinationSlackChannelId, destinationSlackParentMessageTs: userInfo[destinationSlackChannelId]},
    timestampOfLastMessageInThread
  );
};

exports.determineVoterState = async (userOptions, redisClient, twilioPhoneNumber, inboundDbMessageEntry) => {
  logger.debug("ENTERING ROUTER.determineVoterState");
  const userInfo = userOptions.userInfo;
  const userPhoneNumber = userOptions.userPhoneNumber;
  const userId = userInfo.userId;
  const userMessage = userOptions.userMessage;

  userInfo.lastVoterMessageSecsFromEpoch = Math.round(Date.now() / 1000);
  logger.debug(`ROUTER.determineVoterState: Updating lastVoterMessageSecsFromEpoch to ${userInfo.lastVoterMessageSecsFromEpoch}`);

  const lobbyChannelId = userInfo.activeChannelId;
  const lobbyParentMessageTs = userInfo[lobbyChannelId];

  logger.debug(`ROUTER.determineVoterState: Passing voter message to Slack, slackChannelName: ${lobbyChannelId}, parentMessageTs: ${lobbyParentMessageTs}.`);
  const response = await SlackApiUtil.sendMessage(
    `*${userId.substring(0,5)}:* ${userMessage}`,
    { parentMessageTs: lobbyParentMessageTs, channel: lobbyChannelId },
    inboundDbMessageEntry,
    userInfo,
  );

  const stateName = StateParser.determineState(userMessage);
  if (stateName == null) {
    logger.debug(`ROUTER.determineVoterState: StateParser could not determine U.S. state of voter from message ${userMessage}`);
    await TwilioApiUtil.sendMessage(MessageConstants.CLARIFY_STATE(), {userPhoneNumber, twilioPhoneNumber},
      DbApiUtil.populateAutomatedDbMessageEntry(userInfo)
    );
    await SlackApiUtil.sendMessage(`*Automated Message:* ${MessageConstants.CLARIFY_STATE()}`,
      {parentMessageTs: lobbyParentMessageTs, channel: lobbyChannelId});

    logger.debug(`ROUTER.determineVoterState: Writing updated userInfo to Redis.`);
    await RedisApiUtil.setHash(redisClient, `${userId}:${twilioPhoneNumber}`, userInfo);

    return;
  }

  // This is used for display as well as to know later that the voter's
  // U.S. state has been determined.
  userInfo.stateName = stateName;
  logger.debug(`ROUTER.determineVoterState: StateParser reviewed ${userMessage} and determined U.S. state: ${stateName}`);

  await TwilioApiUtil.sendMessage(
    MessageConstants.STATE_CONFIRMATION(stateName),
    {userPhoneNumber, twilioPhoneNumber},
    DbApiUtil.populateAutomatedDbMessageEntry(userInfo)
  );

  // Slack channel name must abide by the rules in this function.
  let selectedStateChannelName = await LoadBalancer.selectSlackChannel(redisClient, LoadBalancer.PULL_ENTRY_POINT, stateName, userInfo.isDemo);

  await SlackApiUtil.sendMessage(
    `*Automated Message:* ${MessageConstants.STATE_CONFIRMATION(stateName)}`,
    {parentMessageTs: lobbyParentMessageTs, channel: lobbyChannelId}
  );

  if (!selectedStateChannelName) {
    logger.error(`ROUTER.determineVoterState: ERROR in selecting U.S. state channel. Defaulting to #lobby.`);
    logger.error('I am bright red');
    selectedStateChannelName = "#lobby";
  } else {
    logger.debug(`ROUTER.determineVoterState: U.S. state channel successfully selected: ${selectedStateChannelName}`);
  }

  await routeVoterToSlackChannel(userInfo, redisClient, {userId, twilioPhoneNumber, destinationSlackChannelName: selectedStateChannelName});
};

exports.handleDisclaimer = async (userOptions, redisClient, twilioPhoneNumber, inboundDbMessageEntry) => {
  logger.debug("ENTERING ROUTER.handleDisclaimer");
  const userInfo = userOptions.userInfo;
  const userId = userInfo.userId;
  const userMessage = userOptions.userMessage;
  const slackLobbyMessageParams = {
      parentMessageTs: userInfo[userInfo.activeChannelId],
      channel: userInfo.activeChannelId,
    };

  logger.debug(`ROUTER.handleDisclaimer: Updating lastVoterMessageSecsFromEpoch to ${userInfo.lastVoterMessageSecsFromEpoch}`);
  userInfo.lastVoterMessageSecsFromEpoch = Math.round(Date.now() / 1000);

  const response = await SlackApiUtil.sendMessage(`*${userId.substring(0,5)}:* ${userMessage}`, slackLobbyMessageParams, inboundDbMessageEntry, userInfo);

  const userMessageNoPunctuation = userOptions.userMessage.replace(/[.,?\/#!$%\^&\*;:{}=\-_`~()]/g, '');
  const cleared = userMessageNoPunctuation.toLowerCase().trim() == "agree";
  let automatedMessage;
  if (cleared) {
    logger.debug(`ROUTER.handleDisclaimer: Voter cleared disclaimer with message ${userMessage}.`);
    userInfo.confirmedDisclaimer = true;
    automatedMessage = MessageConstants.DISCLAIMER_CONFIRMATION_AND_STATE_QUESTION();
  } else {
    logger.debug(`ROUTER.handleDisclaimer: Voter did not clear disclaimer with message ${userMessage}.`);
    automatedMessage = MessageConstants.CLARIFY_DISCLAIMER();
  }

  await RedisApiUtil.setHash(redisClient, `${userId}:${twilioPhoneNumber}`, userInfo);
  await TwilioApiUtil.sendMessage(
    automatedMessage,
    {userPhoneNumber: userOptions.userPhoneNumber, twilioPhoneNumber},
    DbApiUtil.populateAutomatedDbMessageEntry(userInfo)
  );

  await SlackApiUtil.sendMessage(`*Automated Message:* ${automatedMessage}`, slackLobbyMessageParams);
};

exports.handleClearedVoter = async (userOptions, redisClient, twilioPhoneNumber, inboundDbMessageEntry) => {
  logger.debug("ENTERING ROUTER.handleClearedVoter");
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

  const response = await SlackApiUtil.sendMessage(
    `*${userId.substring(0,5)}:* ${userOptions.userMessage}`,
    activeChannelMessageParams, inboundDbMessageEntry, userInfo
  );

  logger.debug(`ROUTER.handleClearedVoter: Seconds since last message from voter: ${nowSecondsEpoch - lastVoterMessageSecsFromEpoch}`);

  if (nowSecondsEpoch - lastVoterMessageSecsFromEpoch > MINS_BEFORE_WELCOME_BACK_MESSAGE * 60) {
    logger.debug(`ROUTER.handleClearedVoter: Seconds since last message from voter > MINS_BEFORE_WELCOME_BACK_MESSAGE (${nowSecondsEpoch - lastVoterMessageSecsFromEpoch} > : ${MINS_BEFORE_WELCOME_BACK_MESSAGE}), sending welcome back message.`);
    const welcomeBackMessage = MessageConstants.WELCOME_BACK();
    await TwilioApiUtil.sendMessage(welcomeBackMessage, {userPhoneNumber: userOptions.userPhoneNumber, twilioPhoneNumber});
    await SlackApiUtil.sendMessage(`*Automated Message:* ${welcomeBackMessage}`, activeChannelMessageParams);
  }

  logger.debug(`ROUTER.handleClearedVoter: Writing updated userInfo to Redis.`);
  await RedisApiUtil.setHash(redisClient, `${userId}:${twilioPhoneNumber}`, userInfo);
};

exports.handleSlackVoterThreadMessage = async (req, redisClient, redisData, originatingSlackUserName) => {
  logger.debug("ENTERING ROUTER.handleSlackVoterThreadMessage");
  const reqBody = req.body;

  const userPhoneNumber = redisData.userPhoneNumber;
  const twilioPhoneNumber = redisData.twilioPhoneNumber;
  if (!userPhoneNumber) {
    return;
  }

  logger.debug(`ROUTER.handleSlackVoterThreadMessage: Successfully determined userPhoneNumber from Redis`);
  const unprocessedSlackMessage = reqBody.event.text;
  logger.debug(`Received message from Slack: ${unprocessedSlackMessage}`);

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

  const userInfo = await RedisApiUtil.getHash(redisClient, `${userId}:${twilioPhoneNumber}`);
  // Only relay Slack messages from the active Slack thread.
  if (userInfo.activeChannelId === reqBody.event.channel) {
    userInfo.lastVoterMessageSecsFromEpoch = Math.round(Date.now() / 1000);
    if (!userInfo.volunteerEngaged) {
      logger.debug("Router: volunteer engaged, suppressing automated system.")
      userInfo.volunteerEngaged = true;
    }
    await RedisApiUtil.setHash(redisClient, `${userId}:${twilioPhoneNumber}`, userInfo);
    await DbApiUtil.updateDbMessageEntryWithUserInfo(userInfo, outboundDbMessageEntry);
    await TwilioApiUtil.sendMessage(messageToSend,
                              {userPhoneNumber,
                                twilioPhoneNumber},
                                outboundDbMessageEntry);
  // Slack message is from inactive Slack thread.
  } else {
    await SlackApiUtil.sendMessage(`*Operator:* Your message was not relayed, as this thread is inactive. The voter's active thread is in ${userInfo.activeChannelName}.`,
                                  {channel: reqBody.event.channel, parentMessageTs: reqBody.event.thread_ts});
  }
};

exports.handleSlackAdminCommand = async (reqBody, redisClient, originatingSlackUserName) => {
  logger.debug(" ENTERING ROUTER.handleSlackAdminCommand");
  const adminCommandArgs = CommandUtil.parseSlackCommand(reqBody.event.text);
  logger.debug(`ROUTER.handleSlackAdminCommand: Parsed admin control command params: ${JSON.stringify(adminCommandArgs)}`);
  if (!adminCommandArgs) {
    await SlackApiUtil.sendMessage(`*Operator:* Your command could not be parsed (did you closely follow the required format)?`,
                                    {channel: process.env.ADMIN_CONTROL_ROOM_SLACK_CHANNEL_ID, parentMessageTs: reqBody.event.ts});
    return;
  }

  switch (adminCommandArgs.command) {
    case CommandUtil.ROUTE_VOTER:
      // TODO: Move some of this logic to CommandUtil, so this swith statement
      // is cleaner.
      const redisHashKey = `${adminCommandArgs.userId}:${adminCommandArgs.twilioPhoneNumber}`;
      logger.debug(`ROUTER.handleSlackAdminCommand: Looking up ${redisHashKey} in Redis.`);
      const userInfo = await RedisApiUtil.getHash(redisClient, redisHashKey);

      // This catches invalid userPhoneNumber:twilioPhoneNumber pairs.
      if (!userInfo) {
        logger.debug("Router.handleSlackAdminCommand: No Redis data found for userId:twilioPhoneNumber pair.");
        await SlackApiUtil.sendMessage(`*Operator:* No record found for user ID (${adminCommandArgs.userId}) and/or Twilio phone number (${adminCommandArgs.twilioPhoneNumber}).`,
                                        {channel: process.env.ADMIN_CONTROL_ROOM_SLACK_CHANNEL_ID, parentMessageTs: reqBody.event.ts});
      // userPhoneNumber:twilioPhoneNumber pair found successfully.
      } else {
        // Voter already in destination slack channel (error).
        if (userInfo.activeChannelName === adminCommandArgs.destinationSlackChannelName) {
          logger.debug("Router.handleSlackAdminCommand: Voter is already active in destination Slack channel.");
          await SlackApiUtil.sendMessage(`*Operator:* Voter's thread in ${userInfo.activeChannelName} is already the active thread.`,
                                          {channel: process.env.ADMIN_CONTROL_ROOM_SLACK_CHANNEL_ID, parentMessageTs: reqBody.event.ts});
        } else {
          const adminCommandParams = {
            commandParentMessageTs: reqBody.event.ts,
            previousSlackChannelName: userInfo.activeChannelName,
            routingSlackUserName: originatingSlackUserName,
          };
          logger.debug(`Router.handleSlackAdminCommand: Routing voter from ${userInfo.activeChannelName} to ${adminCommandArgs.destinationSlackChannelName}.`);
          await routeVoterToSlackChannel(userInfo, redisClient, adminCommandArgs, adminCommandParams);
        }
      }
      return;
    case CommandUtil.FIND_VOTER:
      await CommandUtil.findVoter(redisClient, adminCommandArgs.voterIdentifier);
      return;
    case CommandUtil.RESET_VOTER:
      await CommandUtil.resetVoter(redisClient, adminCommandArgs.userId, adminCommandArgs.twilioPhoneNumber);
      return;
    default:
      logger.info(`ROUTER.handleSlackAdminCommand: Unknown Slack admin command`);
      return;
  }
};
