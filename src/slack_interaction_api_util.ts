import axios from 'axios';
import { voterStatusPanel, SlackBlock } from './slack_block_util';
import logger from './logger';

export async function replaceSlackMessageBlocks({
  slackChannelId,
  slackParentMessageTs,
  newBlocks,
}: {
  slackChannelId: string;
  slackParentMessageTs: number;
  newBlocks: SlackBlock[];
}): Promise<void> {
  logger.info('ENTERING SLACKINTERACTIONAPIUTIL.replaceSlackMessageBlocks');
  // Replace voter status panel with message.
  const response = await axios.post(
    'https://slack.com/api/chat.update',
    {
      'Content-Type': 'application/json',
      channel: slackChannelId,
      token: process.env.SLACK_BOT_ACCESS_TOKEN,
      ts: slackParentMessageTs,
      blocks: newBlocks,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_ACCESS_TOKEN}`,
      },
    }
  );

  if (response.data.ok) {
    logger.info(
      `SLACKINTERACTIONAPIUTIL.replaceSlackMessageBlock: Successfully replaced Slack message block`
    );
  } else {
    logger.error(
      `SLACKINTERACTIONAPIUTIL.replaceSlackMessageBlock: ERROR in replacing Slack message block: ${response.data.error}`
    );
  }
}

export function addBackVoterStatusPanel({
  slackChannelId,
  slackParentMessageTs,
  oldBlocks,
}: {
  slackChannelId: string;
  slackParentMessageTs: number;
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
