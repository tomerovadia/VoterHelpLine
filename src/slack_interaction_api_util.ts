import { voterStatusPanel, SlackBlock } from './slack_block_util';
import logger from './logger';
import { UserInfo } from './types';
import * as SlackApiUtil from './slack_api_util';
import * as SlackInteractionHandler from './slack_interaction_handler';
import { PromisifiedRedisClient } from './redis_client';
import * as SlackBlockUtil from './slack_block_util';

export async function replaceSlackMessageBlocks({
  slackChannelId,
  slackParentMessageTs,
  newBlocks,
}: {
  slackChannelId: string;
  slackParentMessageTs: string;
  newBlocks: SlackBlock[];
}): Promise<void> {
  logger.info('ENTERING SLACKINTERACTIONAPIUTIL.replaceSlackMessageBlocks');
  // Replace voter status panel with message.
  const response = await SlackApiUtil.slackAPI.post('chat.update', {
    channel: slackChannelId,
    token: process.env.SLACK_BOT_ACCESS_TOKEN,
    ts: slackParentMessageTs,
    blocks: newBlocks,
  });
  if (response.data.ok) {
    logger.info(
      `SLACKINTERACTIONAPIUTIL.replaceSlackMessageBlock: Successfully replaced Slack message block`
    );
  } else {
    logger.error(
      `SLACKINTERACTIONAPIUTIL.replaceSlackMessageBlock: ERROR in replacing Slack message block: ${JSON.stringify(
        response.data
      )}`
    );
  }
}

export function addBackVoterStatusPanel({
  slackChannelId,
  slackParentMessageTs,
  oldBlocks,
}: {
  slackChannelId: string;
  slackParentMessageTs: string;
  oldBlocks: SlackBlock[];
}): Promise<void> {
  logger.info('ENTERING SLACKINTERACTIONAPIUTIL.addBackVoterStatusPanel');

  const voterInfoBlock = oldBlocks[0];
  const volunteerDropdownBlock = oldBlocks[1];
  const newBlocks = [voterInfoBlock, volunteerDropdownBlock];
  newBlocks.push(voterStatusPanel);

  return replaceSlackMessageBlocks({
    slackChannelId,
    slackParentMessageTs,
    newBlocks,
  });
}

export async function updateOldSessionBlocks(
  channelId: string,
  threadTs: string
): Promise<void> {
  let blocks = await SlackApiUtil.fetchSlackMessageBlocks(channelId, threadTs);
  if (blocks) {
    const closedBlocks = SlackBlockUtil.makeClosedVoterPanelBlocks(
      `This voter helpline session is closed`,
      false /* no undo button */
    );
    const newBlocks = [blocks[0]].concat(closedBlocks);
    await replaceSlackMessageBlocks({
      slackChannelId: channelId,
      slackParentMessageTs: threadTs,
      newBlocks: newBlocks,
    });
  }
}

// This function is used in app.js for automated refusals.
export async function handleAutomatedCollapseOfVoterStatusPanel({
  userInfo,
  redisClient,
  newVoterStatus,
  userPhoneNumber,
  twilioPhoneNumber,
}: {
  userInfo: UserInfo;
  redisClient: PromisifiedRedisClient;
  newVoterStatus: SlackInteractionHandler.VoterStatusUpdate;
  userPhoneNumber: string;
  twilioPhoneNumber: string;
}): Promise<void> {
  const messageBlocks = await SlackApiUtil.fetchSlackMessageBlocks(
    userInfo.activeChannelId,
    userInfo[userInfo.activeChannelId]
  );

  if (!messageBlocks) {
    throw new Error(
      `Could not get Slack blocks for known user ${userInfo.userId}`
    );
  }

  const payload = {
    automatedButtonSelection: true,
    message: {
      blocks: messageBlocks,
    },
    container: {
      thread_ts: userInfo[userInfo.activeChannelId],
    },
    channel: {
      id: userInfo.activeChannelId,
    },
    user: {
      id: null,
    },
  };

  await SlackInteractionHandler.handleVoterStatusUpdate({
    payload,
    selectedVoterStatus: newVoterStatus,
    originatingSlackUserName: 'AUTOMATED',
    slackChannelName: userInfo.activeChannelName,
    userPhoneNumber,
    twilioPhoneNumber,
    redisClient,
  });
}
