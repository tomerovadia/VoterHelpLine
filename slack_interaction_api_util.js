const axios = require('axios');
const SlackBlockUtil = require('./slack_block_util');

const replaceSlackMessageBlocks = ({slackChannelId, slackParentMessageTs, newBlocks}) => {
  console.log("\nENTERING SLACKINTERACTIONAPIUTIL.replaceSlackMessageBlocks");
  // Replace voter status panel with message.
  return axios.post('https://slack.com/api/chat.update', {
    'Content-Type': 'application/json',
    'channel': slackChannelId,
    'token': process.env.SLACK_BOT_ACCESS_TOKEN,
    'ts': slackParentMessageTs,
    'blocks': newBlocks,
  },
  {
    'headers': {
      "Authorization": `Bearer ${process.env.SLACK_BOT_ACCESS_TOKEN}`,
    },
  }).then(response => {
    if (response.data.ok) {
      console.log(`SLACKINTERACTIONAPIUTIL.replaceSlackMessageBlock: Successfully replaced Slack message block`);
    } else {
      console.log('\x1b[41m%s\x1b[1m\x1b[0m', `SLACKINTERACTIONAPIUTIL.replaceSlackMessageBlock: ERROR in replacing Slack message block: ${response.data.error}`);
    }
  }).catch(error => {
    console.log('\x1b[41m%s\x1b[1m\x1b[0m', `SLACKINTERACTIONAPIUTIL.replaceSlackMessageBlock: ERROR in replacing Slack message block: ${error.data.error}`);
    return error;
  });
};

exports.replaceSlackMessageBlocks = replaceSlackMessageBlocks;

exports.addBackVoterStatusPanel = ({slackChannelId, slackParentMessageTs, oldBlocks}) => {
  console.log("\nENTERING SLACKINTERACTIONAPIUTIL.addBackVoterStatusPanel");

  const voterInfoBlock = oldBlocks[0];
  const volunteerDropdownBlock = oldBlocks[1];
  const newBlocks = [voterInfoBlock, volunteerDropdownBlock];
  newBlocks.push(SlackBlockUtil.voterStatusPanel);

  return replaceSlackMessageBlocks({slackChannelId, slackParentMessageTs, newBlocks});
};
