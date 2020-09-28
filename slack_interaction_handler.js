const Hashes = require('jshashes'); // v1.0.5
const DbApiUtil = require('./db_api_util');
const SlackApiUtil = require('./slack_api_util');
const LoadBalancer = require('./load_balancer');
const SlackBlockUtil = require('./slack_block_util');
const SlackInteractionApiUtil = require('./slack_interaction_api_util');
const RedisApiUtil = require('./redis_api_util');
const logger = require('./logger');

const getClosedVoterPanelText = (
  selectedVoterStatus,
  originatingSlackUserName
) => {
  logger.info('ENTERING SLACKINTERACTIONAPIUTIL.getClosedVoterPanelText');
  const timeSinceEpochSecs = Date.parse(new Date()) / 1000;
  // See https://api.slack.com/reference/surfaces/formatting#visual-styles
  const specialSlackTimestamp = `<!date^${timeSinceEpochSecs}^{date_num} {time_secs}|${new Date()}>`;

  switch (selectedVoterStatus) {
    case 'VOTED':
      return `*Congratulations!* :tada: This voter has been marked as *VOTED* by *${originatingSlackUserName}* as of *${specialSlackTimestamp}*. On to the next one! :ballot_box_with_ballot:`;
    default:
      return `:no_entry_sign: This voter was marked as *${selectedVoterStatus}* by *${originatingSlackUserName}* on *${specialSlackTimestamp}*. :no_entry_sign:`;
  }
};

const handleVoterStatusUpdateHelper = async ({
  payload,
  // eslint-disable-next-line no-unused-vars
  res,
  selectedVoterStatus,
  originatingSlackUserName,
  originatingSlackChannelName,
  userPhoneNumber,
  twilioPhoneNumber,
  // eslint-disable-next-line no-unused-vars
  redisClient,
}) => {
  logger.info('ENTERING SLACKINTERACTIONHANDLER.handleVoterStatusUpdate');
  const MD5 = new Hashes.MD5();
  const userId = MD5.hex(userPhoneNumber);

  const timeSinceEpochSecs = Date.parse(new Date()) / 1000;
  // See https://api.slack.com/reference/surfaces/formatting#visual-styles
  const specialSlackTimestamp = `<!date^${timeSinceEpochSecs}^{date_num} {time_secs}|${new Date()}>`;

  // Post a message in the voter thread recording this status change.
  await SlackApiUtil.sendMessage(
    `*Operator:* Voter status changed to *${selectedVoterStatus}* by *${originatingSlackUserName}* at *${specialSlackTimestamp}*.`,
    {
      parentMessageTs: payload.container.thread_ts,
      channel: payload.channel.id,
    }
  );

  logger.info(
    `SLACKINTERACTIONHANDLER.handleVoterStatusUpdate: Successfully sent message recording voter status change`
  );

  await DbApiUtil.logVoterStatusToDb({
    userId,
    userPhoneNumber,
    twilioPhoneNumber,
    isDemo: LoadBalancer.phoneNumbersAreDemo(
      twilioPhoneNumber,
      userPhoneNumber
    ),
    voterStatus: selectedVoterStatus,
    originatingSlackUserName,
    originatingSlackUserId: payload.user.id,
    originatingSlackChannelName,
    originatingSlackChannelId: payload.channel.id,
    originatingSlackParentMessageTs: payload.container.thread_ts,
    actionTs: payload.actions[0].action_ts,
  });
};

exports.handleVoterStatusUpdate = async ({
  payload,
  res,
  selectedVoterStatus,
  originatingSlackUserName,
  originatingSlackChannelName,
  userPhoneNumber,
  twilioPhoneNumber,
  redisClient,
}) => {
  // Interaction is selection of a new voter status, from either dropdown selection or button press.
  if (
    Object.keys(SlackBlockUtil.getVoterStatusOptions()).includes(
      selectedVoterStatus
    )
  ) {
    logger.info(
      `SLACKINTERACTIONHANDLER.handleVoterStatusUpdate: Determined user interaction is a voter status update`
    );
    await handleVoterStatusUpdateHelper({
      payload,
      res,
      selectedVoterStatus,
      originatingSlackUserName,
      originatingSlackChannelName,
      userPhoneNumber,
      twilioPhoneNumber,
      redisClient,
    });

    if (payload.actions[0].type === 'button') {
      const closedVoterPanelText = getClosedVoterPanelText(
        selectedVoterStatus,
        originatingSlackUserName
      );
      const closedVoterPanelBlocks = SlackBlockUtil.makeClosedVoterPanelBlocks(
        closedVoterPanelText,
        true /* include undo button */
      );
      const newParentMessageBlocks = SlackBlockUtil.replaceVoterPanelBlocks(
        payload.message.blocks,
        closedVoterPanelBlocks
      );

      await SlackInteractionApiUtil.replaceSlackMessageBlocks({
        slackChannelId: payload.channel.id,
        slackParentMessageTs: payload.container.thread_ts,
        newBlocks: newParentMessageBlocks,
      });

      // Make sure we don't text voters marked as REFUSED or SPAM.
      if (selectedVoterStatus === 'REFUSED' || selectedVoterStatus === 'SPAM') {
        await RedisApiUtil.setHash(
          redisClient,
          'slackBlockedUserPhoneNumbers',
          { [userPhoneNumber]: '1' }
        );
        if (selectedVoterStatus === 'SPAM') {
          await RedisApiUtil.setHash(
            redisClient,
            'twilioBlockedUserPhoneNumbers',
            { [userPhoneNumber]: '1' }
          );
        }
      }
      // Steps to take if the dropdown was changed.
    } else {
      // Take the blocks and replace the initial_option with the new status, so that
      // even when Slack is refreshed this new status is shown.
      SlackBlockUtil.populateDropdownNewInitialValue(
        payload.message.blocks,
        selectedVoterStatus
      );

      // Replace the entire block so that the initial option change persists.
      await SlackInteractionApiUtil.replaceSlackMessageBlocks({
        slackChannelId: payload.channel.id,
        slackParentMessageTs: payload.container.thread_ts,
        newBlocks: payload.message.blocks,
      });
    }
  } else if (
    selectedVoterStatus === 'UNDO' &&
    payload.actions[0].type === 'button'
  ) {
    logger.info(
      `SLACKINTERACTIONHANDLER.handleVoterStatusUpdate: Determined user interaction is UNDO of voter status update`
    );
    await handleVoterStatusUpdateHelper({
      payload,
      selectedVoterStatus: 'UNKNOWN',
      originatingSlackUserName,
      originatingSlackChannelName,
      userPhoneNumber,
      twilioPhoneNumber,
      redisClient,
    });

    await SlackInteractionApiUtil.addBackVoterStatusPanel({
      slackChannelId: payload.channel.id,
      slackParentMessageTs: payload.container.thread_ts,
      oldBlocks: payload.message.blocks,
    });

    // For code simplicity, this executes even if "VOTED" is the button clicked before "UNDO".
    await RedisApiUtil.deleteHashField(
      redisClient,
      'slackBlockedUserPhoneNumbers',
      userPhoneNumber
    );
    await RedisApiUtil.deleteHashField(
      redisClient,
      'twilioBlockedUserPhoneNumbers',
      userPhoneNumber
    );
  }
};

exports.handleVolunteerUpdate = async ({
  payload,
  // eslint-disable-next-line no-unused-vars
  res,
  originatingSlackUserName,
  originatingSlackChannelName,
  userPhoneNumber,
  twilioPhoneNumber,
}) => {
  logger.info(
    `SLACKINTERACTIONHANDLER.handleVolunteerUpdate: Determined user interaction is a volunteer update`
  );
  const selectedVolunteerSlackUserName = await SlackApiUtil.fetchSlackUserName(
    payload.actions[0].selected_user
  );
  const MD5 = new Hashes.MD5();
  const userId = MD5.hex(userPhoneNumber);

  const timeSinceEpochSecs = Date.parse(new Date()) / 1000;
  // See https://api.slack.com/reference/surfaces/formatting#visual-styles
  const specialSlackTimestamp = `<!date^${timeSinceEpochSecs}^{date_num} {time_secs}|${new Date()}>`;

  // Post a message in the voter thread recording this status change.
  await SlackApiUtil.sendMessage(
    `*Operator:* Volunteer changed to *${selectedVolunteerSlackUserName}* by *${originatingSlackUserName}* at *${specialSlackTimestamp}*.`,
    {
      parentMessageTs: payload.container.thread_ts,
      channel: payload.channel.id,
    }
  );

  logger.info(
    `SLACKINTERACTIONHANDLER.handleVoterStatusUpdate: Successfully sent message recording voter status change`
  );

  await DbApiUtil.logVolunteerVoterClaimToDb({
    userId,
    userPhoneNumber,
    twilioPhoneNumber,
    isDemo: LoadBalancer.phoneNumbersAreDemo(
      twilioPhoneNumber,
      userPhoneNumber
    ),
    volunteerSlackUserName: selectedVolunteerSlackUserName,
    volunteerSlackUserId: payload.actions[0].selected_user,
    originatingSlackUserName,
    originatingSlackUserId: payload.user.id,
    originatingSlackChannelName,
    originatingSlackChannelId: payload.channel.id,
    originatingSlackParentMessageTs: payload.container.thread_ts,
    actionTs: payload.actions[0].action_ts,
  });

  // Take the blocks and replace the initial_user with the new user, so that
  // even when Slack is refreshed this new status is shown.
  SlackBlockUtil.populateDropdownNewInitialValue(
    payload.message.blocks,
    payload.actions[0].selected_user
  );

  // Replace the entire block so that the initial user change persists.
  await SlackInteractionApiUtil.replaceSlackMessageBlocks({
    slackChannelId: payload.channel.id,
    slackParentMessageTs: payload.container.thread_ts,
    newBlocks: payload.message.blocks,
  });
};
