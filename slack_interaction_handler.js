const axios = require('axios');
const Hashes = require('jshashes'); // v1.0.5
const DbApiUtil = require('./db_api_util');
const SlackApiUtil = require('./slack_api_util');
const LoadBalancer = require('./load_balancer');

exports.handleVoterStatusUpdate = (payload, selectedValue, originatingSlackUserName, originatingSlackChannelName, userPhoneNumber, twilioPhoneNumber) => {
  console.log("\nENTERING SLACKINTERACTIONHANDLER.handleVoterStatusUpdate");
  const MD5 = new Hashes.MD5;
  const userId = MD5.hex(userPhoneNumber);

  const timeSinceEpochSecs = Date.parse(new Date()) / 1000;
  // See https://api.slack.com/reference/surfaces/formatting#visual-styles
  const specialSlackTimestamp = `<!date^${timeSinceEpochSecs}^{date_num} {time_secs}|${new Date()}>`;

  // Post a message in the voter thread recording this status change.
  return SlackApiUtil.sendMessage(`*Operator:* Voter status changed to *${selectedValue}* by *${originatingSlackUserName}* at *${specialSlackTimestamp}*.`,
                                    {parentMessageTs: payload.container.thread_ts, channel: payload.channel.id}).then(() => {
    console.log(`SLACKINTERACTIONHANDLER.handleVoterStatusUpdate: Successfully sent message recording voter status change`);

    return DbApiUtil.logVoterStatusToDb({
      userId,
      userPhoneNumber,
      twilioPhoneNumber,
      isDemo: LoadBalancer.phoneNumbersAreDemo(twilioPhoneNumber, userPhoneNumber),
      voterStatus: selectedValue,
      originatingSlackUserName,
      originatingSlackUserId: payload.user.id,
      originatingSlackChannelName,
      originatingSlackChannelId: payload.channel.id,
      originatingSlackParentMessageTs: payload.container.thread_ts,
      actionTs: payload.actions[0].action_ts,
    }).catch(error => {
      console.log('\x1b[41m%s\x1b[1m\x1b[0m', `SLACKINTERACTIONHANDLER.handleVoterStatusUpdate: ERROR clearing voter status panel: ${error}`);
      return error;
    });
  }).catch(error => {
    console.log('\x1b[41m%s\x1b[1m\x1b[0m', `SLACKINTERACTIONHANDLER.handleVoterStatusUpdate: ERROR sending message on voter status change: ${error}`);
    return error;
  });
};

exports.getClosedVoterPanelText = (selectedValue, originatingSlackUserName) => {
  console.log("\nENTERING SLACKINTERACTIONAPIUTIL.getClosedVoterPanelText");
  const timeSinceEpochSecs = Date.parse(new Date()) / 1000;
  // See https://api.slack.com/reference/surfaces/formatting#visual-styles
  const specialSlackTimestamp = `<!date^${timeSinceEpochSecs}^{date_num} {time_secs}|${new Date()}>`;

  switch(selectedValue) {
    case "VOTED":
      return `*Congratulations!* :tada: This voter has been marked as *VOTED* by *${originatingSlackUserName}* as of *${specialSlackTimestamp}*. On to the next one! :ballot_box_with_ballot:`;
    default:
    //TODO add date that this happened
      return `:no_entry_sign: This voter was marked as *${selectedValue}* by *${originatingSlackUserName}* on *${specialSlackTimestamp}*. :no_entry_sign:`;
  }
};
