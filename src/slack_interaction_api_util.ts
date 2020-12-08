import {
  voterStatusPanel,
  voterTopicPanel,
  SlackBlock,
} from './slack_block_util';
import logger from './logger';
import { UserInfo, SessionTopics, VoterStatus } from './types';
import * as SlackApiUtil from './slack_api_util';
import * as SlackInteractionHandler from './slack_interaction_handler';
import { PromisifiedRedisClient } from './redis_client';
import * as SlackBlockUtil from './slack_block_util';
import { cloneDeep } from 'lodash';
import { SlackActionId } from './slack_interaction_ids';

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
  status,
  topics,
}: {
  slackChannelId: string;
  slackParentMessageTs: string;
  oldBlocks: SlackBlock[];
  status: VoterStatus;
  topics: string[];
}): Promise<void> {
  logger.info('ENTERING SLACKINTERACTIONAPIUTIL.addBackVoterStatusPanel');

  const voterInfoBlock = oldBlocks[0];
  const volunteerDropdownBlock = oldBlocks[1];
  const newBlocks = [voterInfoBlock, volunteerDropdownBlock];
  newBlocks.push(voterStatusPanel);
  SlackBlockUtil.populateDropdownNewInitialValue(
    newBlocks,
    SlackActionId.VOTER_STATUS_DROPDOWN,
    status
  );

  const topicBlock = cloneDeep(voterTopicPanel);
  if (topics.length > 0) {
    topicBlock.accessory.initial_options = topics.map((topic) => {
      return {
        text: {
          type: 'plain_text',
          text: SessionTopics[topic],
        },
        value: topic,
      };
    });
  }
  newBlocks.push(topicBlock);

  return replaceSlackMessageBlocks({
    slackChannelId,
    slackParentMessageTs,
    newBlocks,
  });
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
  const payload = {
    automatedButtonSelection: true,
    message: {
      blocks: [], // these are not needed by handleVoterStatusUpdate
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
    userInfo,
    payload,
    selectedVoterStatus: newVoterStatus,
    originatingSlackUserName: 'AUTOMATED',
    slackChannelName: userInfo.activeChannelName,
    userPhoneNumber,
    twilioPhoneNumber,
    redisClient,
  });
}
