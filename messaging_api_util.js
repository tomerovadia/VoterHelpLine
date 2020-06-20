const SlackApiUtil = require('./slack_api_util');
const TwilioApiUtil = require('./twilio_api_util');

exports.sendTwilioAndSlackMessage = (message, slackOptions, twilioOptions) => {
  TwilioApiUtil.sendMessage(message, twilioOptions);
  SlackApiUtil.sendMessage(message, slackOptions);
}
