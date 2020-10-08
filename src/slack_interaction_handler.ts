import Hashes from 'jshashes';
import * as DbApiUtil from './db_api_util';
import * as SlackApiUtil from './slack_api_util';
import * as LoadBalancer from './load_balancer';
import * as SlackBlockUtil from './slack_block_util';
import * as SlackInteractionApiUtil from './slack_interaction_api_util';
import { SlackActionId } from './slack_interaction_ids';
import * as RedisApiUtil from './redis_api_util';
import logger from './logger';
import { VoterStatus } from './types';
import { PromisifiedRedisClient } from './redis_client';
import { UserInfo, SlackThreadInfo } from './types';

export type VoterStatusUpdate = VoterStatus | 'UNDO';

export type SlackInteractionEventPayload = {
  type: string;
  callback_id: string;
  trigger_id: string;
  view: {
    callback_id: string;
    private_metadata: string;
  };
  container: {
    thread_ts: string;
  };
  channel: {
    id: string;
  };
  actions: SlackBlockUtil.SlackBlock[];
  user: {
    id: string;
  };
  message: {
    ts: string;
    blocks: SlackBlockUtil.SlackBlock[];
  };
  automatedButtonSelection: boolean | undefined;
  action_ts: string;
};

export type SlackSyntheticPayload = {
  container: {
    thread_ts: string;
  };
  channel: {
    id: string;
  };
  actions?: undefined;
  user: {
    id: null;
  };
  message: {
    blocks: SlackBlockUtil.SlackBlock[];
  };
  automatedButtonSelection: boolean | undefined;
};

type Payload = SlackInteractionEventPayload | SlackSyntheticPayload;

export type SlackModalPrivateMetadata = {
  commandType: string;
  userId: string;
  userPhoneNumber: string;
  twilioPhoneNumber: string;
  slackChannelId: string;
  slackParentMessageTs: string;
  originatingSlackUserName: string;
  originatingSlackUserId: string;
  slackChannelName: string;
  actionTs: string;
  success?: boolean;
  failureReason?: string;
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
      return `:no_entry_sign: This voter was marked as *${selectedVoterStatus}* by *${originatingSlackUserName}* on *${specialSlackTimestamp}*. :no_entry_sign:`;
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
  slackChannelName: string | null;
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
  slackChannelName: string | null;
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
      if (
        !SlackBlockUtil.populateDropdownNewInitialValue(
          payload.message.blocks,
          payload.actions
            ? payload.actions[0].action_id
            : SlackActionId.VOTER_STATUS_DROPDOWN,
          selectedVoterStatus as VoterStatus
        )
      ) {
        logger.error(
          'SLACKINTERACTIONHANDLER.handleVoterStatusUpdate: Error updating VOTER_STATUS_DROPDOWN'
        );
      }

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
  slackChannelName: string | null;
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
  if (
    !SlackBlockUtil.populateDropdownNewInitialValue(
      payload.message.blocks,
      payload.actions
        ? payload.actions[0].action_id
        : SlackActionId.VOLUNTEER_DROPDOWN,
      payload.actions ? payload.actions[0].selected_user : null
    )
  ) {
    logger.error(
      'SLACKINTERACTIONHANDLER.handleVoterStatusUpdate: Error updating VOLUNTEER_DROPDOWN'
    );
  }

  // Replace the entire block so that the initial user change persists.
  await SlackInteractionApiUtil.replaceSlackMessageBlocks({
    slackChannelId: payload.channel.id,
    slackParentMessageTs: payload.container.thread_ts,
    newBlocks: payload.message.blocks,
  });
}

// This function receives the initial request to reset a demo
// and response by creating a modal populated with data needed
// to reset the demo if the Slack user confirms.
export async function receiveResetDemo({
  payload,
  redisClient,
  modalPrivateMetadata,
  twilioPhoneNumber,
  userId,
  viewId,
}: {
  payload: SlackInteractionEventPayload;
  redisClient: PromisifiedRedisClient;
  modalPrivateMetadata: SlackModalPrivateMetadata;
  twilioPhoneNumber: string;
  userId: string;
  viewId: string;
}): Promise<void> {
  logger.info(`Entering SLACKINTERACTIONHANDLER.receiveResetDemo`);
  let slackView;

  try {
    const redisUserInfoKey = `${userId}:${twilioPhoneNumber}`;
    const userInfo = (await RedisApiUtil.getHash(
      redisClient,
      redisUserInfoKey
    )) as UserInfo;

    if (!userInfo) {
      modalPrivateMetadata.success = false;
      modalPrivateMetadata.failureReason = 'no_user_info';
      await DbApiUtil.logCommandToDb(modalPrivateMetadata);
      throw new Error(
        `SLACKINTERACTIONHANDLER.receiveResetDemo: Interaction received for voter who has redisData but not userInfo: active redisData key is ${payload.channel.id}:${payload.message.ts}, userInfo key is ${redisUserInfoKey}.`
      );
    }

    if (!userInfo.isDemo) {
      modalPrivateMetadata.success = false;
      modalPrivateMetadata.failureReason = 'non_demo';
      await DbApiUtil.logCommandToDb(modalPrivateMetadata);
      logger.info(
        `SLACKINTERACTIONHANDLER.receiveResetDemo: Volunteer tried to reset demo on non-demo voter.`
      );
      slackView = SlackBlockUtil.getErrorSlackView(
        'demo_reset_error_not_demo',
        'This shortcut is strictly for demo conversations only. Please reach out to an admin for assistance.'
      );
    } else if (!(payload.channel.id === userInfo.activeChannelId)) {
      modalPrivateMetadata.success = false;
      modalPrivateMetadata.failureReason = 'non_active_thread';
      await DbApiUtil.logCommandToDb(modalPrivateMetadata);
      logger.info(
        `SLACKINTERACTIONHANDLER.receiveResetDemo: Volunteer issued reset demo command from #${payload.channel.id} but voter active channel is ${userInfo.activeChannelId}.`
      );
      slackView = SlackBlockUtil.getErrorSlackView(
        'demo_reset_error_not_active_thread',
        `This voter is no longer active in this thread. Please reach out to the folks at *#${userInfo.activeChannelName}*.`
      );
    } else {
      logger.info(
        `SLACKINTERACTIONHANDLER.receiveResetDemo: Reset demo command is valid.`
      );

      // Store the relevant information in the modal so that when the requested action is confirmed
      // the data needed for the necessary actions is available.
      slackView = SlackBlockUtil.resetConfirmationSlackView(
        'RESET_DEMO',
        modalPrivateMetadata
      );
    }

    await SlackApiUtil.updateModal(viewId, slackView);
  } catch (e) {
    // Update the modal to say that there was an error, then re-throw the
    // error so it ends up in Sentry / the logs
    await SlackApiUtil.updateModal(
      viewId,
      SlackBlockUtil.getErrorSlackView(
        'internal_server_error',
        'Sorry, something went wrong. Please try again.'
      )
    );
    throw e;
  }
}

// This function receives the confirmation of the resetting of
// a voter and does the actual resetting work.
export async function handleResetDemo(
  redisClient: PromisifiedRedisClient,
  modalPrivateMetadata: SlackModalPrivateMetadata
): Promise<void> {
  const redisUserInfoKey = `${modalPrivateMetadata.userId}:${modalPrivateMetadata.twilioPhoneNumber}`;

  const slackThreads = (await DbApiUtil.getSlackThreadsForVoter(
    modalPrivateMetadata.userId,
    modalPrivateMetadata.twilioPhoneNumber
  )) as SlackThreadInfo[];

  const redisDatas = slackThreads.map(
    (row) => `${row.slackChannel}:${row.slackParentMessageTs}`
  );

  const numKeysPresent = await RedisApiUtil.keysExist(redisClient, [
    redisUserInfoKey,
    ...redisDatas,
  ]);

  // If any key is missing, something is wrong, so log and don't try to delete.
  // Count = multiple Slack thread lookups + 1 phone number lookup for this user.
  let redisError = numKeysPresent !== slackThreads.length + 1;

  // If all keys are present, try to delete.
  if (!redisError) {
    const numKeysDeleted = await RedisApiUtil.deleteKeys(redisClient, [
      redisUserInfoKey,
      ...redisDatas,
    ]);
    // If all keys don't delete, something is wrong, so log.
    redisError = numKeysDeleted !== slackThreads.length + 1;
  }

  if (redisError) {
    modalPrivateMetadata.success = false;
    modalPrivateMetadata.failureReason = 'missing_redis_key';
    await DbApiUtil.logCommandToDb(modalPrivateMetadata);
    throw new Error(
      `SLACKINTERACTIONHANDLER.handleResetDemo: Either the userInfo (${redisUserInfoKey}) or one of the redisData keys (${JSON.stringify(
        slackThreads
      )}) for the voter in Redis was not found.`
    );
  }

  const timeSinceEpochSecs = Math.round(Date.now() / 1000);
  // See https://api.slack.com/reference/surfaces/formatting#visual-styles
  const specialSlackTimestamp = `<!date^${timeSinceEpochSecs}^{date_num} {time_secs}|${new Date()}>`;

  const closedVoterPanelText = `:white_check_mark: This demo conversation was closed by *${modalPrivateMetadata.originatingSlackUserName}* on *${specialSlackTimestamp}*. :white_check_mark:`;

  const closedVoterPanelBlocks = SlackBlockUtil.makeClosedVoterPanelBlocks(
    closedVoterPanelText,
    false /* include undo button */
  );

  const previousParentMessageBlocks = await SlackApiUtil.fetchSlackMessageBlocks(
    modalPrivateMetadata.slackChannelId,
    modalPrivateMetadata.slackParentMessageTs
  );

  logger.info(
    `SLACKINTERACTIONHANDLER.handleResetDemo: Fetched previousParentMessageBlocks.`
  );

  if (previousParentMessageBlocks === null) {
    modalPrivateMetadata.success = false;
    modalPrivateMetadata.failureReason = 'message_blocks_fetch_failure';
    await DbApiUtil.logCommandToDb(modalPrivateMetadata);
    throw new Error(
      `SLACKINTERACTIONHANDLER.handleResetDemo: Failed to fetch Slack message blocks for channelId (${modalPrivateMetadata.slackChannelId}) and parentMessageTs (${modalPrivateMetadata.slackParentMessageTs}).`
    );
  }

  const newParentMessageBlocks = SlackBlockUtil.replaceVoterPanelBlocks(
    previousParentMessageBlocks,
    closedVoterPanelBlocks
  );

  await SlackInteractionApiUtil.replaceSlackMessageBlocks({
    slackChannelId: modalPrivateMetadata.slackChannelId,
    slackParentMessageTs: modalPrivateMetadata.slackParentMessageTs,
    newBlocks: newParentMessageBlocks,
  });

  await DbApiUtil.archiveMessagesForDemoVoter(
    modalPrivateMetadata.userId,
    modalPrivateMetadata.twilioPhoneNumber
  );

  modalPrivateMetadata.success = true;
  await DbApiUtil.logCommandToDb(modalPrivateMetadata);

  return;
}
