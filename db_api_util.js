const { Client } = require('pg');

exports.logMessageToDb = (databaseMessageEntry) => {
  console.log(`\nENTERING DBAPIUTIL.logMessageToDb`);
  const pgDatabaseClient = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  pgDatabaseClient.connect()
    .then(() => {
      pgDatabaseClient.query("INSERT INTO messages (message, direction, automated, successfully_sent, from_phone_number, user_id, to_phone_number, originating_slack_user_id, slack_channel, slack_parent_message_ts, twilio_message_sid, slack_message_ts, slack_error, twilio_error, twilio_send_timestamp, twilio_receive_timestamp, slack_send_timestamp, slack_receive_timestamp, confirmed_disclaimer, is_demo, last_voter_message_secs_from_epoch, unprocessed_message, slack_retry_num, slack_retry_reason, originating_slack_user_name, entry_point) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26);", [
        databaseMessageEntry.message,
        databaseMessageEntry.direction,
        databaseMessageEntry.automated,
        databaseMessageEntry.successfullySent,
        databaseMessageEntry.fromPhoneNumber,
        databaseMessageEntry.userId,
        databaseMessageEntry.toPhoneNumber,
        databaseMessageEntry.originatingSlackUserId,
        databaseMessageEntry.slackChannel,
        databaseMessageEntry.slackParentMessageTs,
        databaseMessageEntry.twilioMessageSid,
        databaseMessageEntry.slackMessageTs,
        databaseMessageEntry.slackError,
        databaseMessageEntry.twilioError,
        databaseMessageEntry.twilioSendTimestamp,
        databaseMessageEntry.twilioReceiveTimestamp,
        databaseMessageEntry.slackSendTimestamp,
        databaseMessageEntry.slackReceiveTimestamp,
        databaseMessageEntry.confirmedDisclaimer,
        databaseMessageEntry.isDemo,
        databaseMessageEntry.lastVoterMessageSecsFromEpoch,
        databaseMessageEntry.unprocessedMessage,
        databaseMessageEntry.slackRetryNum,
        databaseMessageEntry.slackRetryReason,
        databaseMessageEntry.originatingSlackUserName,
        databaseMessageEntry.entryPoint
      ], (err, res) => {
        if (err) {
          console.log(`DBAPIUTIL.logMessageToDb: ERROR from PostgreSQL database insert:`, err);
        } else {
          console.log(`DBAPIUTIL.logMessageToDb: Successfully inserted into PostgreSQL database.`);
        }
        pgDatabaseClient.end();
      });
    })
    .catch(err => console.log(`DBAPIUTIL.logMessageToDb: ERROR connecting to PostgreSQL database:`, err.stack));
};

// Populates immediately available info into the DB entry upon receiving a message from Twilio.
exports.populateIncomingDbMessageTwilioEntry = ({userMessage, userPhoneNumber, twilioPhoneNumber, twilioMessageSid, entryPoint}) => {
  return {
    message: userMessage,
    // Only for Slack incoming
    unprocessedMessage: null,
    direction: "INBOUND",
    // To be filled later
    entryPoint,
    automated: null,
    // To be updated later
    successfullySent: false,
    fromPhoneNumber: userPhoneNumber,
    toPhoneNumber: twilioPhoneNumber,
    originatingSlackUserId: null,
    originatingSlackUserName: null,

    // To be filled later
    slackChannel: null,
    // To be filled later
    slackParentMessageTs: null,

    twilioMessageSid,
    // To be filled later
    slackMessageTs: null,
    // To be maybe filled later
    slackError: null,
    twilioError: null,

    twilioSendTimestamp: null,
    twilioReceiveTimestamp: new Date(),
    // To be filled later
    slackSendTimestamp: null,
    slackReceiveTimestamp: null,

    // Only for Slack incoming
    slackRetryNum: null,
    // Only for Slack incoming
    slackRetryReason: null,

    // Note: These are userInfo fields. Keep these null so that their only set is right before sending, so that the actual values are ensured to be logged.
    // To be filled later
    userId: null,
    // To be filled later
    confirmedDisclaimer: null,
    // To be filled later
    isDemo: null,
    // To be filled later
    lastVoterMessageSecsFromEpoch: null,
  };
};

// Populates immediately available info into the DB entry upon receiving a message from Slack.
exports.populateIncomingDbMessageSlackEntry = ({unprocessedMessage, originatingSlackUserId, slackChannel, slackParentMessageTs, slackMessageTs, slackRetryNum, slackRetryReason, originatingSlackUserName, entryPoint}) => {
  return {
    unprocessedMessage,
    direction: "OUTBOUND",
    // To be filled later
    entryPoint: null,
    automated: false,

    // To be filled later
    successfullySent: null,
    // To be filled later
    fromPhoneNumber: null,
    // To be filled later
    toPhoneNumber: null,
    originatingSlackUserId,
    originatingSlackUserName,

    slackChannel,
    slackParentMessageTs,

    // To be filled later
    twilioMessageSid: null,
    slackMessageTs,
    slackError: null,

    // To be filled later
    twilioSendTimestamp: null,
    twilioReceiveTimestamp: null,
    slackSendTimestamp: null,
    slackReceiveTimestamp: new Date(),

    slackRetryNum,
    slackRetryReason,

    // Note: These are userInfo fields. Keep these null so that their only set is right before sending, so that the actual values are ensured to be logged.
    // To be filled later
    userId: null,
    // To be filled later
    confirmedDisclaimer: null,
    // To be filled later
    isDemo: null,
    // To be filled later
    lastVoterMessageSecsFromEpoch: null,
  };
};

// Updates an incoming DB entry right before it is sent with information from the userInfo.
exports.updateDbMessageEntryWithUserInfo = (userInfo, dbMessageEntry) => {
  dbMessageEntry.userId = userInfo.userId;
  dbMessageEntry.confirmedDisclaimer = userInfo.confirmedDisclaimer;
  dbMessageEntry.isDemo = userInfo.isDemo;
  dbMessageEntry.lastVoterMessageSecsFromEpoch = userInfo.lastVoterMessageSecsFromEpoch;
  dbMessageEntry.entryPoint = userInfo.entryPoint;
};

// Populates a DB entry with available info right before it is passed to TwilioApiUtil for additional info and writing to DB.
exports.populateAutomatedDbMessageEntry = (userInfo) => {
  return {
    message: null,
    // Only for incoming Slack messages.
    unprocessedMessage: null,
    direction: "OUTBOUND",
    entryPoint: userInfo.entryPoint,
    automated: true,

    // To be filled later
    successfullySent: null,
    // To be filled later
    fromPhoneNumber: null,
    // To be filled later
    toPhoneNumber: null,
    originatingSlackUserId: null,
    originatingSlackUserName: null,

    // Since this message doesn't originate from and isn't intended for Slack,
    // these are considered irrelevant.
    slackChannel: null,
    slackParentMessageTs: null,

    // To be filled later
    twilioMessageSid: null,
    // Since this message doesn't originate from and isn't intended for Slack,
    // these are considered irrelevant.
    slackMessageTs: null,
    slackError: null,

    // To be filled later
    twilioSendTimestamp: null,
    twilioReceiveTimestamp: null,
    slackSendTimestamp: null,
    slackReceiveTimestamp: null,

    // Only for Slack incoming
    slackRetryNum: null,
    // Only for Slack incoming
    slackRetryReason: null,

    userId: userInfo.userId,
    confirmedDisclaimer: userInfo.confirmedDisclaimer,
    isDemo: userInfo.isDemo,
    lastVoterMessageSecsFromEpoch: userInfo.lastVoterMessageSecsFromEpoch,
  };
};

const MESSAGE_HISTORY_SQL_SCRIPT = `SELECT
                                    (CASE
                                        WHEN twilio_receive_timestamp IS NOT NULL
                                          THEN twilio_receive_timestamp
                                        WHEN slack_receive_timestamp IS NOT NULL
                                          THEN slack_receive_timestamp
                                        ELSE twilio_send_timestamp
                                      END) AS timestamp,
                                    message,
                                    automated,
                                    direction,
                                    originating_slack_user_name
                                  FROM messages
                                  WHERE user_id = $1
                                        AND (CASE WHEN twilio_receive_timestamp IS NOT NULL THEN twilio_receive_timestamp WHEN slack_receive_timestamp IS NOT NULL THEN slack_receive_timestamp ELSE twilio_send_timestamp END) > $2
                                  ORDER BY timestamp ASC;`;

exports.getMessageHistoryFor = (userId, timestampSince) => {
  console.log(`\nENTERING DBAPIUTIL.getMessageHistoryFor`);
  console.log(`DBAPIUTIL.getMessageHistoryFor: Looking up user:${userId}, message history since timestamp: ${timestampSince}.`);
  const pgDatabaseClient = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  return pgDatabaseClient.connect()
    .then(() => {
      return pgDatabaseClient.query(MESSAGE_HISTORY_SQL_SCRIPT, [userId, timestampSince]).then(result => {
        console.log(`DBAPIUTIL.getMessageHistoryFor: Successfully looked up message historyin PostgreSQL.`);
        pgDatabaseClient.end();
        return result.rows;
      })
      .catch(err => {
        console.log(`DBAPIUTIL.getMessageHistoryFor: ERROR from PostgreSQL message history lookup:`, err);
        pgDatabaseClient.end();
      });
    })
    .catch(err => {
      console.log(`DBAPIUTIL.getMessageHistoryFor: ERROR connecting to PostgreSQL database:`, err.stack);
    });
};

const LAST_TIMESTAMP_SQL_SCRIPT = `SELECT
                                    	(CASE WHEN twilio_receive_timestamp IS NOT NULL THEN twilio_receive_timestamp WHEN slack_receive_timestamp IS NOT NULL THEN slack_receive_timestamp ELSE twilio_send_timestamp END) AS timestamp
                                    FROM messages
                                    WHERE
                                    	slack_parent_message_ts = $1
                                    ORDER BY timestamp DESC
                                    LIMIT 1;`;

exports.getTimestampOfLastMessageInThread = (parentMessageTs) => {
  console.log(`\nENTERING DBAPIUTIL.getTimestampOfLastMessageInThread`);
  console.log(`DBAPIUTIL.getMessageHistoryFor: Looking up last message timestamp in Slack thread ${parentMessageTs}.`);
  const pgDatabaseClient = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  return pgDatabaseClient.connect()
    .then(() => {
      return pgDatabaseClient.query(LAST_TIMESTAMP_SQL_SCRIPT, [parentMessageTs]).then(result => {
        console.log(`DBAPIUTIL.getMessageHistoryFor: Successfully looked up last timestamp in thread.`);
        pgDatabaseClient.end();
        // Just in case nobody said anything while the user was at a channel.
        if (result.rows.length > 0) {
          return result.rows[0].timestamp;
        } else {
          return "1990-01-01 10:00:00.000";
        }
      })
      .catch(err => {
        console.log(`DBAPIUTIL.getMessageHistoryFor: ERROR from PostgreSQL last timestamp in thread lookup:`, err);
        pgDatabaseClient.end();
      });
    })
    .catch(err => {
      console.log(`DBAPIUTIL.getTimestampOfLastMessageInThread: ERROR connecting to PostgreSQL database:`, err.stack);
    });
};
