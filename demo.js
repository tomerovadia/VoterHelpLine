const Promise = require('bluebird');
const SlackApiUtil = require('./slack_api_util');

exports.demoSlack = () => {
  Promise.delay(5000).then(() => {
    SlackApiUtil.sendMessage('<!channel> Operator: New voter! (4600087425).', {
      channel: '#lobby',
    }).then((response) => {
      const parentMessageTs = response.data.ts;
      const channel = response.data.channel;
      SlackApiUtil.sendMessage('Voter 4600087425: Hi can you help me vote?', {
        channel,
        parentMessageTs,
      });
      Promise.delay(1000).then(() => {
        SlackApiUtil.sendMessage(
          'Automated Message: Welcome to the Voter Help Line! To match you with the most knowlegeable volunteer, in which U.S. state are you looking to vote? We currently service NC and WI. (Msg & data rates may apply).',
          { channel, parentMessageTs }
        );
        Promise.delay(7000).then(() => {
          SlackApiUtil.sendMessage('Voter 4600087425: NC', {
            channel,
            parentMessageTs,
          }).then((/* response */) => {
            Promise.delay(1500).then(() => {
              SlackApiUtil.sendMessages(
                [
                  'Automated Message: Great! We are connecting you with a North Carolina volunteer. In the meantime, please feel free to share more information about your question and situation.',
                  'Operator: Routing voter to #north-carolina.',
                ],
                { channel, parentMessageTs }
              ).then((/* response */) => {
                SlackApiUtil.sendMessage(
                  '@channel Operator: New North Carolina voter! (4600087425).',
                  { channel: '#north-carolina' }
                ).then((response) => {
                  const parentMessageTs = response.data.ts;
                  const channel = response.data.channel;
                  SlackApiUtil.sendMessages(
                    [
                      'Voter 4600087425: Hi can you help me vote?',
                      'Automated Message: Welcome to the Voter Help Line! To match you with the most knowlegeable volunteer, in which U.S. state are you looking to vote? We currently service NC and WI. (Msg & data rates may apply).',
                      'Voter 4600087425: NC',
                      'Automated Message: Great! We are connecting you with a North Carolina volunteer. In the meantime, please feel free to share more information about your question and situation.',
                    ],
                    { channel, parentMessageTs }
                  );
                  Promise.delay(24000).then(() => {
                    SlackApiUtil.sendMessage(
                      'Voter 4600087425: I’m wondering if I can register to vote the same day I show up at the polling place.',
                      { channel, parentMessageTs }
                    );
                  });
                });
              });
            });
          });
        });
      });
    });
  });
};
