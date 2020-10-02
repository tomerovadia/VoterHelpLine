import Hashes from 'jshashes';
import * as DbApiUtil from './db_api_util';
import * as SlackApiUtil from './slack_api_util';
import * as LoadBalancer from './load_balancer';
import * as SlackBlockUtil from './slack_block_util';
import * as SlackInteractionApiUtil from './slack_interaction_api_util';
import * as RedisApiUtil from './redis_api_util';
import logger from './logger';
import { VoterStatus } from './types';
import { PromisifiedRedisClient } from './redis_client';

export type VoterStatusUpdate = VoterStatus | 'UNDO';

type Payload = {
  container: {
    thread_ts: number;
  };
  channel: {
    id: string;
  };
  actions?: SlackBlockUtil.SlackBlock[];
  user: {
    id: string | null;
  };
  message: {
    blocks: SlackBlockUtil.SlackBlock[];
  };
  automatedButtonSelection: boolean | undefined;
};

const getClosedVoterPanelText = (
  selectedVoterStatus: VoterStatusUpdate,
  originatingSlackUserName: string
): string => {
  logger.info('ENTERING SLACKINTERACTIONAPIUTIL.getClosedVoterPanelText');
  const timeSinceEpochSecs = Math.round(Date.now() / 1000);
  // See https://api.slack.com/reference/surfaces/formatting#visual-styles
  const specialSlackTimestamp = `<!date^${timeSinceEpochSecs}^{date_num} {time_secs}|${new Date()}>`;

  switch (selectedVoterStatus) {
    case 'VOTED':
      return `*Congratulations!* :tada: This voter was marked as *VOTED* by *${originatingSlackUserName}* on *${specialSlackTimestamp}*. On to the next one! :ballot_box_with_ballot:`;
    default:
      return `:no_entry_sign: This voter  marked as *${selectedVoterStatus}* by *${originatingSlackUserName}* on *${specialSlackTimestamp}*. :no_entry_sign:`;
  }
};

const handleVoterStatusUpdateHelper = async ({
  payload,
  selectedVoterStatus,
  originatingSlackUserName,
  slackChannelName,
  userPhoneNumber,
  twilioPhoneNumber,
}: {
  payload: Payload;
  selectedVoterStatus: VoterStatusUpdate;
  originatingSlackUserName: string;
  slackChannelName: string;
  userPhoneNumber: string;
  twilioPhoneNumber: string;
}) => {
  logger.info('ENTERING SLACKINTERACTIONHANDLER.handleVoterStatusUpdateHelper');
  const MD5 = new Hashes.MD5();
  const userId = MD5.hex(userPhoneNumber);

  const timeSinceEpochSecs = Math.round(Date.now() / 1000);
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
    `SLACKINTERACTIONHANDLER.handleVoterStatusUpdateHelper: Successfully sent message recording voter status change`
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
    slackChannelName,
    slackChannelId: payload.channel.id,
    slackParentMessageTs: payload.container.thread_ts,
    actionTs: payload.actions ? payload.actions[0].action_ts : null,
  });
};

export async function handleVoterStatusUpdate({
  payload,
  selectedVoterStatus,
  originatingSlackUserName,
  slackChannelName,
  userPhoneNumber,
  twilioPhoneNumber,
  redisClient,
}: {
  payload: Payload;
  selectedVoterStatus: VoterStatusUpdate;
  originatingSlackUserName: string;
  slackChannelName: string;
  userPhoneNumber: string;
  twilioPhoneNumber: string;
  redisClient: PromisifiedRedisClient;
}): Promise<void> {
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
      selectedVoterStatus,
      originatingSlackUserName,
      slackChannelName,
      userPhoneNumber,
      twilioPhoneNumber,
    });

    // Accommodate either a button press or an automated, programmatic operation
    // that desires the same effect.
    if (
      (payload.actions && payload.actions[0].type === 'button') ||
      payload.automatedButtonSelection
    ) {
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
        selectedVoterStatus as VoterStatus
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
    payload.actions &&
    payload.actions[0].type === 'button'
  ) {
    logger.info(
      `SLACKINTERACTIONHANDLER.handleVoterStatusUpdate: Determined user interaction is UNDO of voter status update`
    );
    await handleVoterStatusUpdateHelper({
      payload,
      selectedVoterStatus: 'UNKNOWN',
      originatingSlackUserName,
      slackChannelName,
      userPhoneNumber,
      twilioPhoneNumber,
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
}

export async function handleVolunteerUpdate({
  payload,
  originatingSlackUserName,
  slackChannelName,
  userPhoneNumber,
  twilioPhoneNumber,
}: {
  payload: Payload;
  originatingSlackUserName: string;
  slackChannelName: string;
  userPhoneNumber: string;
  twilioPhoneNumber: string;
}): Promise<void> {
  logger.info(
    `SLACKINTERACTIONHANDLER.handleVolunteerUpdate: Determined user interaction is a volunteer update`
  );
  const selectedVolunteerSlackUserName = await SlackApiUtil.fetchSlackUserName(
    payload.actions && payload.actions[0].selected_user
  );
  const MD5 = new Hashes.MD5();
  const userId = MD5.hex(userPhoneNumber);

  const timeSinceEpochSecs = Math.round(Date.now() / 1000);
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
    volunteerSlackUserId: payload.actions
      ? payload.actions[0].selected_user
      : null,
    originatingSlackUserName,
    originatingSlackUserId: payload.user.id,
    slackChannelName,
    slackChannelId: payload.channel.id,
    slackParentMessageTs: payload.container.thread_ts,
    actionTs: payload.actions ? payload.actions[0].action_ts : null,
  });

  // Take the blocks and replace the initial_user with the new user, so that
  // even when Slack is refreshed this new status is shown.
  SlackBlockUtil.populateDropdownNewInitialValue(
    payload.message.blocks,
    payload.actions ? payload.actions[0].selected_user : null
  );

  // Replace the entire block so that the initial user change persists.
  await SlackInteractionApiUtil.replaceSlackMessageBlocks({
    slackChannelId: payload.channel.id,
    slackParentMessageTs: payload.container.thread_ts,
    newBlocks: payload.message.blocks,
  });
}
