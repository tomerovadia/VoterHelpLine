const axios = require('axios');
const SlackBlockUtil = require('./slack_block_util');
const logger = require('./logger');

const replaceSlackMessageBlocks = async ({
  slackChannelId,
  slackParentMessageTs,
  newBlocks,
}) => {
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
};

exports.replaceSlackMessageBlocks = replaceSlackMessageBlocks;

exports.addBackVoterStatusPanel = ({
  slackChannelId,
  slackParentMessageTs,
  oldBlocks,
}) => {
  logger.info('ENTERING SLACKINTERACTIONAPIUTIL.addBackVoterStatusPanel');

  const voterInfoBlock = oldBlocks[0];
  const volunteerDropdownBlock = oldBlocks[1];
  const newBlocks = [voterInfoBlock, volunteerDropdownBlock];
  newBlocks.push(SlackBlockUtil.voterStatusPanel);

  return replaceSlackMessageBlocks({
    slackChannelId,
    slackParentMessageTs,
    newBlocks,
  });
};
