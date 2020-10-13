import { Pool } from 'pg';
import { AddOnResultContext } from 'twilio/lib/rest/api/v2010/account/recording/addOnResult';
import { TextDecoder } from 'util';
import logger from './logger';
import {
  MessageDirection,
  EntryPoint,
  UserInfo,
  HistoricalMessage,
  SlackThreadInfo,
} from './types';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.CONNECTION_POOL_MAX || 20),
});

export type DatabaseMessageEntry = {
  message?: string | null;
  direction: MessageDirection | null;
  automated: boolean | null;
  successfullySent?: boolean | null;
  fromPhoneNumber?: string | null;
  userId: string | null;
  toPhoneNumber?: string | null;
  originatingSlackUserId?: string | null;
  slackChannel?: string | null;
  slackParentMessageTs?: string | null;
  twilioMessageSid?: string | null;
  slackMessageTs?: string | null;
  slackError?: string | null;
  twilioError?: string | null;
  twilioSendTimestamp?: Date | null;
  twilioReceiveTimestamp?: Date | null;
  slackSendTimestamp?: Date | null;
  slackReceiveTimestamp?: Date | null;
  confirmedDisclaimer?: boolean | null;
  isDemo?: boolean | null;
  lastVoterMessageSecsFromEpoch?: number | null;
  unprocessedMessage?: string | null;
  slackRetryNum?: number | null;
  slackRetryReason?: string | null;
  originatingSlackUserName?: string | null;
  entryPoint: EntryPoint | null;
  archived?: boolean | null;
};

export type DatabaseVoterStatusEntry = {
  userId: string | null;
  userPhoneNumber: string | null;
  voterStatus: string | null;
  originatingSlackUserName: string | null;
  originatingSlackUserId: string | null;
  slackChannelName: string | null;
  slackChannelId: string | null;
  slackParentMessageTs: string | null;
  actionTs?: string | null;
  twilioPhoneNumber: string | null;
  isDemo: boolean | null;
};

export type DatabaseVolunteerVoterClaim = {
  userId: string | null;
  userPhoneNumber: string | null;
  twilioPhoneNumber: string | null;
  isDemo: boolean | null;
  volunteerSlackUserName: string | null;
  volunteerSlackUserId: string | null;
  originatingSlackUserName: string | null;
  originatingSlackUserId: string | null;
  slackChannelName: string | null;
  slackChannelId: string | null;
  slackParentMessageTs: string | null;
  actionTs: string | null;
};

export type DatabaseCommandEntry = {
  commandType: string | null;
  userId: string | null;
  userPhoneNumber: string | null;
  twilioPhoneNumber: string | null;
  originatingSlackUserName: string | null;
  originatingSlackUserId: string | null;
  slackChannelName: string | null;
  slackChannelId: string | null;
  slackParentMessageTs: string | null;
  success?: boolean | null;
  actionTs: string | null;
  failureReason?: string | null;
};

export type DatabaseThreadEntry = {
  slackParentMessageTs: string | null;
  channelId: string | null;
  userId: string | null;
  userPhoneNumber: string | null;
  needsAttention: boolean | null;
};

export type ThreadInfo = {
  slackParentMessageTs: string;
  channelId: string;
  userId: string | null;
  userPhoneNumber: string | null;
  age: number | null;
};

export async function newThreadToDb(
  databaseThreadEntry: DatabaseThreadEntry
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      'INSERT INTO threads (slack_parent_message_ts, channel_id, user_id, user_phone_number, needs_attention, updated_at) VALUES ($1, $2, $3, $4, $5, NOW())',
      [
        databaseThreadEntry.slackParentMessageTs,
        databaseThreadEntry.channelId,
        databaseThreadEntry.userId,
        databaseThreadEntry.userPhoneNumber,
        databaseThreadEntry.needsAttention,
      ]
    );
    logger.info('DBAPIUTIL.newThreadToDb: Successfully created thread');
  } catch (error) {
    logger.info('Failed to update threads; ignoring for now!');
  } finally {
    client.release();
  }
}

export async function setThreadNeedsAttentionToDb(
  slackParentMessageTs: string,
  needsAttention: boolean
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      'UPDATE threads SET needs_attention = $1 WHERE slack_parent_message_ts = $2;',
      [needsAttention, slackParentMessageTs]
    );
    logger.info(
      `DBAPIUTIL.setThreadNeedsAttentionToDb: Set thread ${slackParentMessageTs} needs_attention=${needsAttention}`
    );
  } catch (error) {
    logger.info('Failed to update threads; ignoring for now!');
  } finally {
    client.release();
  }
}

export async function getThreadLatestMessage(
  slackParentMessageTs: string
): Promise<string | null> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT slack_message_ts FROM messages
      WHERE slack_parent_message_ts=$1 AND slack_message_ts IS NOT NULL
      ORDER BY COALESCE(slack_send_timestamp, slack_receive_timestamp) DESC LIMIT 1`,
      [slackParentMessageTs]
    );
    if (result.rows.length > 0) {
      return result.rows[0]['slack_message_ts'];
    }
    return null;
  } finally {
    client.release();
  }
}

export async function getThreadsNeedingAttentionFor(
  slackUserId: string
): Promise<ThreadInfo[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
         t.slack_parent_message_ts as id, t.channel_id, t.user_phone_number, t.user_id, EXTRACT(EPOCH FROM now() - t.updated_at) as age
        FROM threads t, volunteer_voter_claims c
        WHERE t.needs_attention
          AND t.user_id=c.user_id
          AND t.user_phone_number=c.user_phone_number
          AND c.volunteer_slack_user_id=$1`,
      [slackUserId]
    );
    return result.rows.map((x) => ({
      slackParentMessageTs: x['id'],
      channelId: x['channel_id'],
      userPhoneNumber: x['user_phone_number'],
      userId: x['user_id'],
      age: x['age'],
    }));
  } catch (error) {
    logger.info('Failed to query threads; ignoring for now!');
    return [];
  } finally {
    client.release();
  }
}

export async function getThreadNeedsAttentionFor(
  slackParentMessageTs: string
): Promise<boolean> {
  logger.info(`ENTERING DBAPIUTIL.getThreadNeedsAttentionFor`);
  logger.info(
    `DBAPIUTIL.getThreadNeedsAttentionFor: Looking up thread:${slackParentMessageTs}`
  );

  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT needs_attention FROM threads WHERE slack_parent_message_ts = $1',
      [slackParentMessageTs]
    );
    logger.info(
      `DBAPIUTIL.getMessageHistoryFor: Successfully looked up message history in PostgreSQL.`
    );
    if (result.rows.length > 0) {
      return result.rows[0].needs_attention;
    }
    return false;
  } catch (error) {
    logger.info('Failed to query threads; assuming needs_attention for now!');
    return true;
  } finally {
    client.release();
  }
}

export async function logMessageToDb(
  databaseMessageEntry: DatabaseMessageEntry
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      'INSERT INTO messages (message, direction, automated, successfully_sent, from_phone_number, user_id, to_phone_number, originating_slack_user_id, slack_channel, slack_parent_message_ts, twilio_message_sid, slack_message_ts, slack_error, twilio_error, twilio_send_timestamp, twilio_receive_timestamp, slack_send_timestamp, slack_receive_timestamp, confirmed_disclaimer, is_demo, last_voter_message_secs_from_epoch, unprocessed_message, slack_retry_num, slack_retry_reason, originating_slack_user_name, entry_point, archived) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27);',
      [
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
        databaseMessageEntry.entryPoint,
        databaseMessageEntry.archived,
      ]
    );
    logger.info(
      `DBAPIUTIL.logMessageToDb: Successfully inserted message into PostgreSQL database.`
    );

    // Update thread status
    if (databaseMessageEntry.direction === 'INBOUND') {
      await client.query(
        'UPDATE threads SET needs_attention = true, updated_at=NOW() WHERE slack_parent_message_ts = $1;',
        [databaseMessageEntry.slackParentMessageTs]
      );
    } else if (
      !databaseMessageEntry.automated &&
      databaseMessageEntry.userId &&
      databaseMessageEntry.toPhoneNumber &&
      (await getVoterHasVolunteer(
        databaseMessageEntry.userId,
        databaseMessageEntry.toPhoneNumber
      ))
    ) {
      await client.query(
        'UPDATE threads SET needs_attention = false, updated_at=NOW() WHERE slack_parent_message_ts = $1;',
        [databaseMessageEntry.slackParentMessageTs]
      );
    } else {
      await client.query(
        'UPDATE threads SET updated_at=NOW() WHERE slack_parent_message_ts = $1;',
        [databaseMessageEntry.slackParentMessageTs]
      );
    }
  } catch (error) {
    logger.info('Failed to update threads; ignoring for now!');
  } finally {
    // Make sure to release the client before any error handling,
    // just in case the error handling itself throws an error.
    client.release();
  }
}

// Populates immediately available info into the DB entry upon receiving a message from Twilio.
export function populateIncomingDbMessageTwilioEntry({
  userMessage,
  userPhoneNumber,
  twilioPhoneNumber,
  twilioMessageSid,
  entryPoint,
}: {
  userMessage: string;
  userPhoneNumber: string;
  twilioPhoneNumber: string;
  twilioMessageSid: string;
  entryPoint: EntryPoint;
}): DatabaseMessageEntry {
  return {
    message: userMessage,
    // Only for Slack incoming
    unprocessedMessage: null,
    direction: 'INBOUND',
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

    archived: false,
  };
}

// Populates immediately available info into the DB entry upon receiving a message from Slack.
export function populateIncomingDbMessageSlackEntry({
  unprocessedMessage,
  originatingSlackUserId,
  slackChannel,
  slackParentMessageTs,
  slackMessageTs,
  slackRetryNum,
  slackRetryReason,
  originatingSlackUserName,
}: {
  unprocessedMessage: string | null;
  originatingSlackUserId: string;
  slackChannel: string;
  slackParentMessageTs: string;
  slackMessageTs: string;
  slackRetryNum?: number;
  slackRetryReason?: string;
  originatingSlackUserName: string;
}): DatabaseMessageEntry {
  return {
    unprocessedMessage,
    direction: 'OUTBOUND',
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

    archived: false,
  };
}

// Updates an incoming DB entry right before it is sent with information from the userInfo.
export function updateDbMessageEntryWithUserInfo(
  userInfo: UserInfo,
  dbMessageEntry: DatabaseMessageEntry
): void {
  dbMessageEntry.userId = userInfo.userId;
  dbMessageEntry.confirmedDisclaimer = userInfo.confirmedDisclaimer;
  dbMessageEntry.isDemo = userInfo.isDemo;
  dbMessageEntry.lastVoterMessageSecsFromEpoch =
    userInfo.lastVoterMessageSecsFromEpoch;
  dbMessageEntry.entryPoint = userInfo.entryPoint;
}

// Populates a DB entry with available info right before it is passed to TwilioApiUtil for additional info and writing to DB.
export function populateAutomatedDbMessageEntry(
  userInfo: UserInfo
): DatabaseMessageEntry {
  return {
    message: null,
    // Only for incoming Slack messages.
    unprocessedMessage: null,
    direction: 'OUTBOUND',
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

    archived: false,
  };
}

const MESSAGE_HISTORY_SQL_SCRIPT = `
  SELECT
    (
      CASE
        WHEN twilio_receive_timestamp IS NOT NULL
          THEN twilio_receive_timestamp
        WHEN slack_receive_timestamp IS NOT NULL
          THEN slack_receive_timestamp
        ELSE twilio_send_timestamp
      END
    ) AS timestamp,
    message,
    automated,
    direction,
    originating_slack_user_name
  FROM messages
  WHERE user_id = $1
    AND NOT archived
    AND (
      CASE
      WHEN twilio_receive_timestamp IS NOT NULL THEN twilio_receive_timestamp
      WHEN slack_receive_timestamp IS NOT NULL THEN slack_receive_timestamp
      ELSE twilio_send_timestamp
      END
    ) > $2
  ORDER BY timestamp ASC;`;

export async function getMessageHistoryFor(
  userId: string,
  timestampSince: string
): Promise<HistoricalMessage[]> {
  logger.info(`ENTERING DBAPIUTIL.getMessageHistoryFor`);
  logger.info(
    `DBAPIUTIL.getMessageHistoryFor: Looking up user:${userId}, message history since timestamp: ${timestampSince}.`
  );

  const client = await pool.connect();
  try {
    const result = await client.query(MESSAGE_HISTORY_SQL_SCRIPT, [
      userId,
      timestampSince,
    ]);
    logger.info(
      `DBAPIUTIL.getMessageHistoryFor: Successfully looked up message history in PostgreSQL.`
    );
    return result.rows;
  } finally {
    client.release();
  }
}

const LAST_TIMESTAMP_SQL_SCRIPT = `
  SELECT
    (
      CASE
      WHEN twilio_receive_timestamp IS NOT NULL THEN twilio_receive_timestamp
      WHEN slack_receive_timestamp IS NOT NULL THEN slack_receive_timestamp
      ELSE twilio_send_timestamp
      END
    ) AS timestamp
  FROM messages
  WHERE
    slack_parent_message_ts = $1
    AND NOT archived
  ORDER BY timestamp DESC
  LIMIT 1;`;

export async function getTimestampOfLastMessageInThread(
  parentMessageTs: string
): Promise<string> {
  logger.info(`ENTERING DBAPIUTIL.getTimestampOfLastMessageInThread`);
  logger.info(
    `DBAPIUTIL.getMessageHistoryFor: Looking up last message timestamp in Slack thread ${parentMessageTs}.`
  );

  const client = await pool.connect();
  try {
    const result = await client.query(LAST_TIMESTAMP_SQL_SCRIPT, [
      parentMessageTs,
    ]);
    logger.info(
      `DBAPIUTIL.getTimestampOfLastMessageInThread: Successfully looked up last timestamp in thread.`
    );

    // Just in case nobody said anything while the user was at a channel.
    if (result.rows.length > 0) {
      return result.rows[0].timestamp;
    } else {
      return '1990-01-01 10:00:00.000';
    }
  } finally {
    client.release();
  }
}

export async function getSlackThreadsForVoter(
  userId: string,
  twilioPhoneNumber: string
): Promise<SlackThreadInfo[] | null> {
  logger.info(`ENTERING DBAPIUTIL.getSlackThreadsForVoter`);

  const client = await pool.connect();

  try {
    const result = await client.query(
      `SELECT slack_channel, slack_parent_message_ts
        FROM messages 
        WHERE user_id = $1 
          AND (to_phone_number = $2 OR from_phone_number = $2)
          AND slack_parent_message_ts IS NOT NULL
          AND NOT archived
        GROUP BY slack_parent_message_ts, slack_channel;`,
      [userId, twilioPhoneNumber]
    );

    if (result.rows.length > 0) {
      logger.info(
        `DBAPIUTIL.getSlackThreadsForVoter: Successfully fetched Slack threads for voter.`
      );
      return result.rows.map((row) => {
        return {
          slackChannel: row.slack_channel,
          slackParentMessageTs: row.slack_parent_message_ts,
        };
      });
    } else {
      return null;
    }
  } finally {
    client.release();
  }
}

export async function archiveMessagesForDemoVoter(
  userId: string,
  twilioPhoneNumber: string
): Promise<void> {
  logger.info(`ENTERING DBAPIUTIL.getSlackThreadsForVoter`);

  const client = await pool.connect();

  try {
    await client.query(
      `UPDATE messages
      SET archived = true
      WHERE is_demo = true AND user_id = $1
        AND (to_phone_number = $2 OR from_phone_number = $2);`,
      [userId, twilioPhoneNumber]
    );

    logger.info(
      `DBAPIUTIL.getSlackThreadsForVoter: Successfully fetched Slack threads for voter.`
    );
  } finally {
    client.release();
  }
}

export async function logVoterStatusToDb(
  databaseVoterStatusEntry: DatabaseVoterStatusEntry
): Promise<void> {
  logger.info(`ENTERING DBAPIUTIL.logVoterStatusToDb`);
  const client = await pool.connect();
  try {
    await client.query(
      'INSERT INTO voter_status_updates (user_id, user_phone_number, voter_status, originating_slack_user_name, originating_slack_user_id, slack_channel_name, slack_channel_id, slack_parent_message_ts, action_ts, twilio_phone_number, is_demo) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);',
      [
        databaseVoterStatusEntry.userId,
        databaseVoterStatusEntry.userPhoneNumber,
        databaseVoterStatusEntry.voterStatus,
        databaseVoterStatusEntry.originatingSlackUserName,
        databaseVoterStatusEntry.originatingSlackUserId,
        databaseVoterStatusEntry.slackChannelName,
        databaseVoterStatusEntry.slackChannelId,
        databaseVoterStatusEntry.slackParentMessageTs,
        databaseVoterStatusEntry.actionTs,
        databaseVoterStatusEntry.twilioPhoneNumber,
        databaseVoterStatusEntry.isDemo,
      ]
    );

    logger.info(
      `DBAPIUTIL.logVoterStatusToDb: Successfully inserted voter status into PostgreSQL database.`
    );
  } finally {
    client.release();
  }
}

const LAST_VOTER_STATUS_SQL_SCRIPT = `SELECT voter_status
                                        FROM voter_status_updates
                                        WHERE user_id = $1
                                        ORDER BY created_at DESC
                                        LIMIT 1;`;

// This used to be used to look up the latest voter status when moving a voter
// from channel to channel, but now instead the voter status is coded into
// the block initial_option on the front-end, and is copied over with the blocks during the move.
export async function getLatestVoterStatus(
  userId: string
): Promise<DatabaseVoterStatusEntry | null> {
  logger.info(`ENTERING DBAPIUTIL.getLatest`);
  logger.info(
    `DBAPIUTIL.getLatestVoterStatus: Looking up last voter status for userId: ${userId}.`
  );
  const client = await pool.connect();

  try {
    const result = await client.query(LAST_VOTER_STATUS_SQL_SCRIPT, [userId]);

    logger.info(
      `DBAPIUTIL.getLatestVoterStatus: Successfully looked up last voter status.`
    );
    if (result.rows.length > 0) {
      return result.rows[0].voter_status;
    } else {
      logger.error(`DBAPIUTIL.getLatestVoterStatus: No voter status for user`);
      return null;
    }
  } finally {
    client.release();
  }
}

export async function logVolunteerVoterClaimToDb(
  databaseVolunteerVoterClaimEntry: DatabaseVolunteerVoterClaim
): Promise<void> {
  logger.info(`ENTERING DBAPIUTIL.logVolunteerVoterClaimToDb`);

  const client = await pool.connect();

  try {
    await client.query(
      'INSERT INTO volunteer_voter_claims (user_id, user_phone_number, twilio_phone_number, is_demo, volunteer_slack_user_name, volunteer_slack_user_id, originating_slack_user_name, originating_slack_user_id, slack_channel_name, slack_channel_id, slack_parent_message_ts, action_ts) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);',
      [
        databaseVolunteerVoterClaimEntry.userId,
        databaseVolunteerVoterClaimEntry.userPhoneNumber,
        databaseVolunteerVoterClaimEntry.twilioPhoneNumber,
        databaseVolunteerVoterClaimEntry.isDemo,
        databaseVolunteerVoterClaimEntry.volunteerSlackUserName,
        databaseVolunteerVoterClaimEntry.volunteerSlackUserId,
        databaseVolunteerVoterClaimEntry.originatingSlackUserName,
        databaseVolunteerVoterClaimEntry.originatingSlackUserId,
        databaseVolunteerVoterClaimEntry.slackChannelName,
        databaseVolunteerVoterClaimEntry.slackChannelId,
        databaseVolunteerVoterClaimEntry.slackParentMessageTs,
        databaseVolunteerVoterClaimEntry.actionTs,
      ]
    );

    logger.info(
      `DBAPIUTIL.logVolunteerVoterClaimToDb: Successfully inserted volunteer voter claim into PostgreSQL database.`
    );
  } finally {
    client.release();
  }
}

export async function getVoterHasVolunteer(
  userId: string,
  userPhoneNumber: string
): Promise<boolean> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT * FROM volunteer_voter_claims WHERE user_id = $1 AND user_phone_number = $2',
      [userId, userPhoneNumber]
    );
    return result.rows.length > 0;
  } finally {
    client.release();
  }
}

/**
 * Updates the Twilio status of the given text message in the DB.
 *
 * Additionally, returns the slack channel and message timestamp so we can
 * react to the message to indicate success/failure
 */
export async function logTwilioStatusToDb(
  messageSid: string,
  status: string
): Promise<null | { slackChannel: string; slackMessageTs: string }> {
  logger.info(`ENTERING DBAPIUTIL.logTwilioStatusToDb`);

  const client = await pool.connect();

  try {
    const result = await client.query(
      `
      UPDATE messages
      SET
        twilio_callback_status = $1,
        twilio_callback_timestamp = now()
      WHERE
        twilio_message_sid = $2
      RETURNING
        slack_channel,
        slack_message_ts
    `,
      [status, messageSid]
    );

    if (result.rows.length > 0) {
      const row = result.rows[0];
      return {
        slackChannel: row.slack_channel,
        slackMessageTs: row.slack_message_ts,
      };
    } else {
      logger.error(
        `DBAPIUTIL.logTwilioStatusToDb: No message with sid ${messageSid}`
      );
      return null;
    }
  } finally {
    client.release();
  }
}

export async function logCommandToDb(
  databaseCommandEntry: DatabaseCommandEntry
): Promise<void> {
  logger.info(`ENTERING DBAPIUTIL.logCommandToDb`);
  const client = await pool.connect();
  try {
    await client.query(
      'INSERT INTO commands (command_type, user_id, user_phone_number, twilio_phone_number, originating_slack_user_name, originating_slack_user_id, slack_channel_name, slack_channel_id, slack_parent_message_ts, success, action_ts, failure_reason) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);',
      [
        databaseCommandEntry.commandType,
        databaseCommandEntry.userId,
        databaseCommandEntry.userPhoneNumber,
        databaseCommandEntry.twilioPhoneNumber,
        databaseCommandEntry.originatingSlackUserName,
        databaseCommandEntry.originatingSlackUserId,
        databaseCommandEntry.slackChannelName,
        databaseCommandEntry.slackChannelId,
        databaseCommandEntry.slackParentMessageTs,
        databaseCommandEntry.success,
        databaseCommandEntry.actionTs,
        databaseCommandEntry.failureReason,
      ]
    );

    logger.info(
      `DBAPIUTIL.logCommandToDb: Successfully inserted command into PostgreSQL database.`
    );
  } finally {
    client.release();
  }
}
