const axios = require('axios');
const Hashes = require('jshashes'); // v1.0.5
const DbApiUtil = require('./db_api_util');
const SlackApiUtil = require('./slack_api_util');
const LoadBalancer = require('./load_balancer');
const SlackBlockUtil = require('./slack_block_util');
const SlackInteractionApiUtil = require('./slack_interaction_api_util');
const RedisApiUtil = require('./redis_api_util');

const getClosedVoterPanelText = (selectedVoterStatus, originatingSlackUserName) => {
  console.log("\nENTERING SLACKINTERACTIONAPIUTIL.getClosedVoterPanelText");
  const timeSinceEpochSecs = Date.parse(new Date()) / 1000;
  // See https://api.slack.com/reference/surfaces/formatting#visual-styles
  const specialSlackTimestamp = `<!date^${timeSinceEpochSecs}^{date_num} {time_secs}|${new Date()}>`;

  switch(selectedVoterStatus) {
    case "VOTED":
      return `*Congratulations!* :tada: This voter has been marked as *VOTED* by *${originatingSlackUserName}* as of *${specialSlackTimestamp}*. On to the next one! :ballot_box_with_ballot:`;
    default:
      return `:no_entry_sign: This voter was marked as *${selectedVoterStatus}* by *${originatingSlackUserName}* on *${specialSlackTimestamp}*. :no_entry_sign:`;
  }
};

const handleVoterStatusUpdateHelper = ({payload,
                                          res,
                                          selectedVoterStatus,
                                          originatingSlackUserName,
                                          originatingSlackChannelName,
                                          userPhoneNumber,
                                          twilioPhoneNumber,
                                          redisClient}) => {
  console.log("\nENTERING SLACKINTERACTIONHANDLER.handleVoterStatusUpdate");
  const MD5 = new Hashes.MD5;
  const userId = MD5.hex(userPhoneNumber);

  const timeSinceEpochSecs = Date.parse(new Date()) / 1000;
  // See https://api.slack.com/reference/surfaces/formatting#visual-styles
  const specialSlackTimestamp = `<!date^${timeSinceEpochSecs}^{date_num} {time_secs}|${new Date()}>`;

  // Post a message in the voter thread recording this status change.
  return SlackApiUtil.sendMessage(`*Operator:* Voter status changed to *${selectedVoterStatus}* by *${originatingSlackUserName}* at *${specialSlackTimestamp}*.`,
                                    {parentMessageTs: payload.container.thread_ts, channel: payload.channel.id}).then(() => {
    console.log(`SLACKINTERACTIONHANDLER.handleVoterStatusUpdate: Successfully sent message recording voter status change`);

    return DbApiUtil.logVoterStatusToDb({
      userId,
      userPhoneNumber,
      twilioPhoneNumber,
      isDemo: LoadBalancer.phoneNumbersAreDemo(twilioPhoneNumber, userPhoneNumber),
      voterStatus: selectedVoterStatus,
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

exports.handleVoterStatusUpdate = ({payload,
                                      res,
                                      selectedVoterStatus,
                                      originatingSlackUserName,
                                      originatingSlackChannelName,
                                      userPhoneNumber,
                                      twilioPhoneNumber,
                                      redisClient}) => {
  // Interaction is selection of a new voter status, from either dropdown selection or button press.
  if (Object.keys(SlackBlockUtil.getVoterStatusOptions()).includes(selectedVoterStatus)) {
    console.log(`SLACKINTERACTIONHANDLER.handleVoterStatusUpdate: Determined user interaction is a voter status update`);
    handleVoterStatusUpdateHelper({payload,
                                    res,
                                    selectedVoterStatus,
                                    originatingSlackUserName,
                                    originatingSlackChannelName,
                                    userPhoneNumber,
                                    twilioPhoneNumber,
                                    redisClient}).then(() => {
      res.sendStatus(200);
      if (payload.actions[0].type === "button") {
        const closedVoterPanelText = getClosedVoterPanelText(selectedVoterStatus, originatingSlackUserName);
        const closedVoterPanelBlocks = SlackBlockUtil.makeClosedVoterPanelBlocks(closedVoterPanelText, true /* include undo button */);
        const newParentMessageBlocks = SlackBlockUtil.replaceVoterPanelBlocks(payload.message.blocks, closedVoterPanelBlocks);
        SlackInteractionApiUtil.replaceSlackMessageBlocks({
            slackChannelId: payload.channel.id,
            slackParentMessageTs: payload.container.thread_ts,
            newBlocks: newParentMessageBlocks,
          });
        // Make sure we don't text voters marked as REFUSED or SPAM.
        if (selectedVoterStatus === "REFUSED" || selectedVoterStatus === "SPAM") {
          RedisApiUtil.setHash(redisClient, "slackBlockedUserPhoneNumbers", {[userPhoneNumber]: "1"});
          if (selectedVoterStatus === "SPAM") {
            RedisApiUtil.setHash(redisClient, "twilioBlockedUserPhoneNumbers", {[userPhoneNumber]: "1"});
          }
        }
      // Steps to take if the dropdown was changed.
      } else {
        // Take the blocks and replace the initial_option with the new status, so that
        // even when Slack is refreshed this new status is shown.
        SlackBlockUtil.populateDropdownNewInitialValue(payload.message.blocks, selectedVoterStatus);
        // Replace the entire block so that the initial option change persists.
        SlackInteractionApiUtil.replaceSlackMessageBlocks({
            slackChannelId: payload.channel.id,
            slackParentMessageTs: payload.container.thread_ts,
            newBlocks: payload.message.blocks,
          });
      }
    }).catch(err => {
      console.log('\x1b[41m%s\x1b[1m\x1b[0m', `SLACKINTERACTIONHANDLER.handleVoterStatusUpdate: ERROR processing voter status update: ${err}`);
      res.sendStatus(500);
    });
  } else if (selectedVoterStatus === "UNDO" && payload.actions[0].type === "button") {
    console.log(`SLACKINTERACTIONHANDLER.handleVoterStatusUpdate: Determined user interaction is UNDO of voter status update`);
    handleVoterStatusUpdateHelper({payload,
      selectedVoterStatus: "UNKNOWN",
      originatingSlackUserName,
      originatingSlackChannelName,
      userPhoneNumber,
      twilioPhoneNumber,
      redisClient}).then(() => {
      res.sendStatus(200);
      SlackInteractionApiUtil.addBackVoterStatusPanel({
          slackChannelId: payload.channel.id,
          slackParentMessageTs: payload.container.thread_ts,
          oldBlocks: payload.message.blocks,
        });
    }).catch(err => {
      console.log('\x1b[41m%s\x1b[1m\x1b[0m', `SLACKINTERACTIONHANDLER.handleVoterStatusUpdate: ERROR processing undo voter status: ${err}`);
      res.sendStatus(500);
    });

    // For code simplicity, this executes even if "VOTED" is the button clicked before "UNDO".
    RedisApiUtil.deleteHashField(redisClient, "slackBlockedUserPhoneNumbers", userPhoneNumber);
    RedisApiUtil.deleteHashField(redisClient, "twilioBlockedUserPhoneNumbers", userPhoneNumber);
  }
};

exports.handleVolunteerUpdate = ({payload,
                                 res,
                                 originatingSlackUserName,
                                 originatingSlackChannelName,
                                 userPhoneNumber,
                                 twilioPhoneNumber}) => {
  console.log(`SLACKINTERACTIONHANDLER.handleVolunteerUpdate: Determined user interaction is a volunteer update`);
  SlackApiUtil.fetchSlackUserName(payload.actions[0].selected_user).then(selectedVolunteerSlackUserName => {
    const MD5 = new Hashes.MD5;
    const userId = MD5.hex(userPhoneNumber);

    const timeSinceEpochSecs = Date.parse(new Date()) / 1000;
    // See https://api.slack.com/reference/surfaces/formatting#visual-styles
    const specialSlackTimestamp = `<!date^${timeSinceEpochSecs}^{date_num} {time_secs}|${new Date()}>`;

    // Post a message in the voter thread recording this status change.
    return SlackApiUtil.sendMessage(`*Operator:* Volunteer changed to *${selectedVolunteerSlackUserName}* by *${originatingSlackUserName}* at *${specialSlackTimestamp}*.`,
                                      {parentMessageTs: payload.container.thread_ts, channel: payload.channel.id}).then(() => {
      console.log(`SLACKINTERACTIONHANDLER.handleVoterStatusUpdate: Successfully sent message recording voter status change`);

      return DbApiUtil.logVolunteerVoterClaimToDb({
        userId,
        userPhoneNumber,
        twilioPhoneNumber,
        isDemo: LoadBalancer.phoneNumbersAreDemo(twilioPhoneNumber, userPhoneNumber),
        volunteerSlackUserName: selectedVolunteerSlackUserName,
        volunteerSlackUserId: payload.actions[0].selected_user,
        originatingSlackUserName,
        originatingSlackUserId: payload.user.id,
        originatingSlackChannelName,
        originatingSlackChannelId: payload.channel.id,
        originatingSlackParentMessageTs: payload.container.thread_ts,
        actionTs: payload.actions[0].action_ts,
      }).then(() => {
        res.sendStatus(200);
        // Take the blocks and replace the initial_user with the new user, so that
        // even when Slack is refreshed this new status is shown.
        SlackBlockUtil.populateDropdownNewInitialValue(payload.message.blocks, payload.actions[0].selected_user);
        // Replace the entire block so that the initial user change persists.
        SlackInteractionApiUtil.replaceSlackMessageBlocks({
            slackChannelId: payload.channel.id,
            slackParentMessageTs: payload.container.thread_ts,
            newBlocks: payload.message.blocks,
          });
      }).catch(error => {
        res.sendStatus(500);
        console.log('\x1b[41m%s\x1b[1m\x1b[0m', `SLACKINTERACTIONHANDLER.handleVoterStatusUpdate: ERROR clearing voter status panel: ${error}`);
        return error;
      });
    }).catch(error => {
      res.sendStatus(500);
      console.log('\x1b[41m%s\x1b[1m\x1b[0m', `SLACKINTERACTIONHANDLER.handleVoterStatusUpdate: ERROR sending message on voter status change: ${error}`);
      return error;
    });
  }).catch(error => {
    res.sendStatus(500);
    console.log('\x1b[41m%s\x1b[1m\x1b[0m', `SLACKINTERACTIONHANDLER.handleVoterStatusUpdate: ERROR fetching Slack name of selected volunteer: ${error}`);
  });
};
