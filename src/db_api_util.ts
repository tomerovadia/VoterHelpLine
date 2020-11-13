import { Pool } from 'pg';
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
import { SlackFile } from './message_parser';

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
  stateName?: string | null;
  slackFiles?: SlackFile[] | null;
  twilioAttachments?: string[] | null;
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
  slackParentMessageTs: string;
  channelId: string;
  userId: string;
  userPhoneNumber: string;
  twilioPhoneNumber: string;
  needsAttention: boolean;
  isDemo: boolean;
  sessionStartEpoch: number | null;
};

export type ThreadInfo = {
  slackParentMessageTs: string;
  channelId: string;
  userId: string | null;
  lastUpdateAge: number | null;
  volunteerSlackUserId: string | null;
  volunteerSlackUserName: string | null;
  historyTs: string | null;
  voterStatus?: string;
  sessionStartEpoch: number;
  sessionEndEpoch: number | null;
};

export type ChannelStat = {
  channelId: string;
  count: number;
  maxLastUpdateAge: number;
};

export type VolunteerStat = {
  volunteerSlackUserId: string;
  volunteerSlackUserName: string;
  count: number;
  maxLastUpdateAge: number;
};

export function epochToPostgresTimestamp(epoch: number): string {
  let d = new Date(0);
  d.setUTCSeconds(epoch);
  return d.toISOString().replace('T', ' ').replace('Z', '');
}

export async function logMessageToDb(
  databaseMessageEntry: DatabaseMessageEntry
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      'INSERT INTO messages (message, direction, automated, successfully_sent, from_phone_number, user_id, to_phone_number, originating_slack_user_id, slack_channel, slack_parent_message_ts, twilio_message_sid, slack_message_ts, slack_error, twilio_error, twilio_send_timestamp, twilio_receive_timestamp, slack_send_timestamp, slack_receive_timestamp, confirmed_disclaimer, is_demo, last_voter_message_secs_from_epoch, unprocessed_message, slack_retry_num, slack_retry_reason, originating_slack_user_name, entry_point, archived, state_name, slack_attachments, twilio_attachments) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30);',
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
        databaseMessageEntry.stateName,

        // We can't just pass these arrays as-is because these are JSON columns,
        // and node-pg serializes arrays as PG arrays rather than JSON arrays.
        databaseMessageEntry.slackFiles
          ? JSON.stringify(databaseMessageEntry.slackFiles)
          : null,
        databaseMessageEntry.twilioAttachments
          ? JSON.stringify(databaseMessageEntry.twilioAttachments)
          : null,
      ]
    );
    logger.info(
      `DBAPIUTIL.logMessageToDb: Successfully inserted message into PostgreSQL database.`
    );
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
  twilioAttachments,
  entryPoint,
}: {
  userMessage: string;
  userPhoneNumber: string;
  twilioPhoneNumber: string;
  twilioMessageSid: string;
  twilioAttachments: string[];
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

    // Array of attached media to MMS
    twilioAttachments,

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

    // To be filled later
    stateName: null,
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

    // To be filled later
    stateName: null,
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
  dbMessageEntry.stateName = userInfo.stateName;
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

    stateName: userInfo.stateName,
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
    originating_slack_user_name,
    slack_attachments,
    twilio_attachments
  FROM messages
  WHERE user_id = $1
    AND NOT archived
    AND (to_phone_number = $2 OR from_phone_number = $2)
    AND (
      CASE
      WHEN twilio_receive_timestamp IS NOT NULL THEN twilio_receive_timestamp
      WHEN slack_receive_timestamp IS NOT NULL THEN slack_receive_timestamp
      ELSE twilio_send_timestamp
      END
    ) >= $3
    AND (
      CASE
      WHEN twilio_receive_timestamp IS NOT NULL THEN twilio_receive_timestamp
      WHEN slack_receive_timestamp IS NOT NULL THEN slack_receive_timestamp
      ELSE twilio_send_timestamp
      END
    ) <= $4
  ORDER BY timestamp ASC;`;

export async function getMessageHistoryFor(
  userId: string,
  twilioPhoneNumber: string,
  timestampSince: string,
  timestampEnd?: string
): Promise<HistoricalMessage[]> {
  logger.info(`ENTERING DBAPIUTIL.getMessageHistoryFor`);
  logger.info(
    `DBAPIUTIL.getMessageHistoryFor: Looking up user:${userId}, ${twilioPhoneNumber}, message history since timestamp: ${timestampSince} to ${timestampEnd}.`
  );

  const client = await pool.connect();
  try {
    if (!timestampEnd) {
      timestampEnd = '2100-01-01 00:00:00';
    }
    const result = await client.query(MESSAGE_HISTORY_SQL_SCRIPT, [
      userId,
      twilioPhoneNumber,
      timestampSince,
      timestampEnd,
    ]);
    logger.info(
      `DBAPIUTIL.getMessageHistoryFor: Successfully looked up message history in PostgreSQL (${result.rowCount})`
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

export async function archiveDemoVoter(
  userId: string,
  twilioPhoneNumber: string
): Promise<void> {
  logger.info(`ENTERING DBAPIUTIL.archiveDemoVoter`);

  const client = await pool.connect();

  try {
    await client.query(
      `UPDATE messages
      SET archived = true
      WHERE is_demo = true AND user_id = $1
        AND (to_phone_number = $2 OR from_phone_number = $2);`,
      [userId, twilioPhoneNumber]
    );
    await client.query(
      `UPDATE voter_status_updates
      SET archived = true
      WHERE
        is_demo = true
        AND user_id = $1
        AND twilio_phone_number = $2`,
      [userId, twilioPhoneNumber]
    );
    await client.query(
      `UPDATE volunteer_voter_claims
      SET archived = true
      WHERE
        is_demo = true
        AND user_id = $1
        AND twilio_phone_number = $2`,
      [userId, twilioPhoneNumber]
    );
    await client.query(
      `UPDATE threads
      SET archived = true
      WHERE
        is_demo = true
        AND user_id = $1
        AND twilio_phone_number = $2`,
      [userId, twilioPhoneNumber]
    );
    logger.info(
      `DBAPIUTIL.archiveDemoVoter: Successfully archived demo voter.`
    );
  } finally {
    client.release();
  }
}

export async function setSessionEnd(
  userId: string,
  twilioPhoneNumber: string
): Promise<void> {
  logger.info(`ENTERING DBAPIUTIL.setSessionEnd`);
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE threads SET session_end_at = (
        SELECT MAX(updated_at) FROM threads WHERE user_id = $1 AND twilio_phone_number = $2 AND session_end_at IS NULL
      )
      WHERE user_id = $1 AND twilio_phone_number = $2 AND session_end_at IS NULL`,
      [userId, twilioPhoneNumber]
    );
  } finally {
    client.release();
  }
}

export async function isActiveSessionThread(
  threadTs: string,
  channelId: string
): Promise<boolean> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT COUNT(*) FROM threads
      WHERE
        slack_parent_message_ts = $1
        AND slack_channel_id = $2
        AND active = true
        AND session_end_at IS NULL
        AND archived IS NOT TRUE`,
      [threadTs, channelId]
    );
    return result.rowCount > 0 && result.rows[0]['count'] > 0;
  } finally {
    client.release();
  }
}

export async function logThreadToDb(
  databaseThreadEntry: DatabaseThreadEntry
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      'INSERT INTO threads (slack_parent_message_ts, slack_channel_id, user_id, user_phone_number, twilio_phone_number, session_start_at, needs_attention, is_demo, updated_at, active) VALUES ($1, $2, $3, $4, $5, TO_TIMESTAMP($6), $7, $8, NOW(), true)',
      [
        databaseThreadEntry.slackParentMessageTs,
        databaseThreadEntry.channelId,
        databaseThreadEntry.userId,
        databaseThreadEntry.userPhoneNumber,
        databaseThreadEntry.twilioPhoneNumber,
        databaseThreadEntry.sessionStartEpoch || 0,
        databaseThreadEntry.needsAttention,
        databaseThreadEntry.isDemo,
      ]
    );
    logger.info('DBAPIUTIL.logThreadToDb: Successfully created thread');
  } finally {
    client.release();
  }
}

export async function updateThreadStatusFromMessage(
  databaseMessageEntry: DatabaseMessageEntry
): Promise<void> {
  const client = await pool.connect();
  try {
    // Update thread status
    let result;
    if (databaseMessageEntry.direction === 'INBOUND') {
      result = await client.query(
        `UPDATE threads
        SET needs_attention = true, updated_at=NOW()
        WHERE slack_parent_message_ts = $1 AND slack_channel_id = $2`,
        [
          databaseMessageEntry.slackParentMessageTs,
          databaseMessageEntry.slackChannel,
        ]
      );
    } else if (
      !databaseMessageEntry.automated &&
      databaseMessageEntry.userId &&
      databaseMessageEntry.toPhoneNumber &&
      (await getVoterHasVolunteer(databaseMessageEntry.userId))
    ) {
      result = await client.query(
        `UPDATE threads
        SET needs_attention = false, updated_at=NOW()
        WHERE slack_parent_message_ts = $1 AND slack_channel_id = $2`,
        [
          databaseMessageEntry.slackParentMessageTs,
          databaseMessageEntry.slackChannel,
        ]
      );
    } else {
      result = await client.query(
        `UPDATE threads
        SET updated_at=NOW()
        WHERE slack_parent_message_ts = $1 AND slack_channel_id = $2`,
        [
          databaseMessageEntry.slackParentMessageTs,
          databaseMessageEntry.slackChannel,
        ]
      );
    }
    if (result.rowCount == 0) {
      // If the thread doesn't already exist (because this thread predates the creation
      // of the threads table), create it now.
      await logThreadToDb({
        slackParentMessageTs: databaseMessageEntry.slackParentMessageTs,
        channelId: databaseMessageEntry.slackChannel,
        userId: databaseMessageEntry.userId,
        userPhoneNumber:
          databaseMessageEntry.direction === 'INBOUND'
            ? databaseMessageEntry.fromPhoneNumber
            : databaseMessageEntry.toPhoneNumber,
        twilioPhoneNumber:
          databaseMessageEntry.direction === 'INBOUND'
            ? databaseMessageEntry.toPhoneNumber
            : databaseMessageEntry.fromPhoneNumber,
        needsAttention: databaseMessageEntry.direction === 'INBOUND',
        sessionStartEpoch: 0 /* kludge but this code path is so rare */,
      } as DatabaseThreadEntry);
    }
  } finally {
    // Make sure to release the client before any error handling,
    // just in case the error handling itself throws an error.
    client.release();
  }
}

export async function setThreadNeedsAttentionToDb(
  slackParentMessageTs: string,
  slackChannelId: string,
  needsAttention: boolean
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      'UPDATE threads SET needs_attention = $1 WHERE slack_parent_message_ts = $2 AND slack_channel_id = $3;',
      [needsAttention, slackParentMessageTs, slackChannelId]
    );
    logger.info(
      `DBAPIUTIL.setThreadNeedsAttentionToDb: Set thread ${slackParentMessageTs} needs_attention=${needsAttention}`
    );
  } finally {
    client.release();
  }
}

export async function reactivateThread(
  slackParentMessageTs: string,
  slackChannelId: string,
  needsAttention: boolean
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      'UPDATE threads SET needs_attention = $1, active = true WHERE slack_parent_message_ts = $2 AND slack_channel_id = $3;',
      [needsAttention, slackParentMessageTs, slackChannelId]
    );
    logger.info(
      `DBAPIUTIL.reactivateThread: Set thread ${slackParentMessageTs} needs_attention=${needsAttention}`
    );
  } finally {
    client.release();
  }
}

export async function setThreadInactive(
  slackParentMessageTs: string,
  slackChannelId: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      'UPDATE threads SET needs_attention = false, active = false WHERE slack_parent_message_ts = $1 AND slack_channel_id = $2;',
      [slackParentMessageTs, slackChannelId]
    );
    logger.info(
      `DBAPIUTIL.setThreadInactive: Set thread ${slackParentMessageTs} active=false, need_attention=false`
    );
  } finally {
    client.release();
  }
}

export async function setThreadHistoryTs(
  slackParentMessageTs: string,
  slackChannelId: string,
  historyTs: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      'UPDATE threads SET history_ts = $1 WHERE slack_parent_message_ts = $2 AND slack_channel_id = $3;',
      [historyTs, slackParentMessageTs, slackChannelId]
    );
  } finally {
    client.release();
  }
}

export async function getThreadLatestMessageTs(
  slackParentMessageTs: string,
  slackChannelId: string
): Promise<string | null> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
        t.history_ts
        , m.slack_message_ts
      FROM threads t
      LEFT JOIN messages m ON (
        t.slack_parent_message_ts=m.slack_parent_message_ts
        AND t.slack_channel_id=m.slack_channel
        AND m.slack_message_ts IS NOT NULL
      )
      WHERE
        t.slack_parent_message_ts=$1
        AND t.slack_channel_id=$2
      ORDER BY COALESCE(m.slack_send_timestamp, m.slack_receive_timestamp) DESC
      LIMIT 1`,
      [slackParentMessageTs, slackChannelId]
    );
    if (result.rows.length > 0) {
      return result.rows[0]['slack_message_ts'] || result.rows[0]['history_ts'];
    }
    return null;
  } finally {
    client.release();
  }
}

export async function getPastSessionThreads(
  userId: string,
  twilioPhoneNumber: string
): Promise<ThreadInfo[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
        t.slack_parent_message_ts
        , t.slack_channel_id
        , t.user_id
        , t.history_ts
        , EXTRACT(EPOCH FROM t.session_start_at) as session_start_epoch
        , EXTRACT(EPOCH FROM t.session_end_at) as session_end_epoch
        , EXTRACT(EPOCH FROM now() - t.updated_at) as last_update_age
      FROM threads t
      WHERE
        archived IS NOT TRUE
        AND active
        AND user_id = $1
        AND twilio_phone_number = $2
        AND session_end_at IS NOT NULL
      ORDER BY t.updated_at`,
      [userId, twilioPhoneNumber]
    );
    return result.rows.map((x) => ({
      slackParentMessageTs: x['slack_parent_message_ts'],
      channelId: x['slack_channel_id'],
      userId: x['user_id'],
      lastUpdateAge: x['last_update_age'],
      volunteerSlackUserId: null,
      volunteerSlackUserName: null,
      historyTs: x['history_ts'],
      sessionStartEpoch: x['session_start_epoch'],
      sessionEndEpoch: x['session_end_epoch'],
    }));
  } finally {
    client.release();
  }
}

export async function getUnclaimedVoters(
  channelId: string
): Promise<ThreadInfo[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `WITH all_status AS (
        SELECT
          user_id, voter_status
          , row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
        FROM voter_status_updates
        WHERE archived IS NOT TRUE
      ), latest_status AS (
        SELECT user_id, voter_status FROM all_status WHERE rn=1
      )
      SELECT
        t.slack_parent_message_ts
        , t.slack_channel_id
        , t.user_id
        , t.history_ts
        , EXTRACT(EPOCH FROM t.session_start_at) as session_start_epoch
        , EXTRACT(EPOCH FROM t.session_end_at) as session_end_epoch
        , EXTRACT(EPOCH FROM now() - t.updated_at) as last_update_age
      FROM threads t
      LEFT JOIN latest_status s ON (t.user_id = s.user_id)
      WHERE
        t.needs_attention
        AND t.slack_channel_id = $1
        AND NOT EXISTS (
          SELECT FROM volunteer_voter_claims c
          WHERE t.user_id=c.user_id
          AND c.archived IS NOT TRUE
        )
        AND s.voter_status NOT IN ('REFUSED', 'SPAM')
      ORDER BY t.updated_at`,
      [channelId]
    );
    return result.rows.map((x) => ({
      slackParentMessageTs: x['slack_parent_message_ts'],
      channelId: x['slack_channel_id'],
      userId: x['user_id'],
      lastUpdateAge: x['last_update_age'],
      volunteerSlackUserId: null,
      volunteerSlackUserName: null,
      historyTs: x['history_ts'],
      sessionStartEpoch: x['session_start_epoch'],
      sessionEndEpoch: x['session_end_epoch'],
    }));
  } finally {
    client.release();
  }
}

// Return a list of ChannelStat's for all unclaimed voters
export async function getUnclaimedVotersByChannel(): Promise<ChannelStat[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `WITH all_status AS (
        SELECT
          user_id, voter_status
          , row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
        FROM voter_status_updates
        WHERE archived IS NOT TRUE
      ), latest_status AS (
        SELECT user_id, voter_status FROM all_status WHERE rn=1
      )
      SELECT
        count(*)
        , slack_channel_id
        , MAX(EXTRACT(EPOCH FROM now() - updated_at)) as max_last_update_age
      FROM threads t
      LEFT JOIN latest_status s ON (t.user_id = s.user_id)
      WHERE
        needs_attention
        AND s.voter_status NOT IN ('REFUSED', 'SPAM')
        AND NOT EXISTS (
          SELECT FROM volunteer_voter_claims c
          WHERE t.user_id=c.user_id
          AND c.archived IS NOT TRUE
        )
      GROUP BY slack_channel_id
      ORDER BY max_last_update_age DESC`
    );
    return result.rows.map(
      (x) =>
        ({
          channelId: x['slack_channel_id'],
          count: x['count'],
          maxLastUpdateAge: x['max_last_update_age'],
        } as ChannelStat)
    );
  } finally {
    client.release();
  }
}

// Return a list of ChannelStat's for all threads needing attention
export async function getThreadsNeedingAttentionByChannel(): Promise<
  ChannelStat[]
> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
        count(*)
        , slack_channel_id
        , MAX(EXTRACT(EPOCH FROM now() - updated_at)) as max_last_update_age
        FROM threads t
        WHERE
          needs_attention
        GROUP BY slack_channel_id
        ORDER BY max_last_update_age DESC`
    );
    return result.rows.map(
      (x) =>
        ({
          channelId: x['slack_channel_id'],
          count: x['count'],
          maxLastUpdateAge: x['max_last_update_age'],
        } as ChannelStat)
    );
  } finally {
    client.release();
  }
}

// Return a list of VolunteerStat's for all threads needing attention
export async function getThreadsNeedingAttentionByVolunteer(): Promise<
  VolunteerStat[]
> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `WITH claims AS (
        SELECT
          user_id
          , volunteer_slack_user_id
          , volunteer_slack_user_name
          , row_number () OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
        FROM volunteer_voter_claims
        WHERE archived IS NOT TRUE
      )
      SELECT
        count(*)
        , volunteer_slack_user_id
        , volunteer_slack_user_name
        , MAX(EXTRACT(EPOCH FROM now() - updated_at)) as max_last_update_age
        FROM threads t, claims c
        WHERE
          needs_attention
          AND t.user_id=c.user_id
          AND c.rn=1
        GROUP BY volunteer_slack_user_id, volunteer_slack_user_name
        ORDER BY max_last_update_age DESC`
    );
    return result.rows.map(
      (x) =>
        ({
          volunteerSlackUserId: x['volunteer_slack_user_id'],
          volunteerSlackUserName: x['volunteer_slack_user_name'],
          count: x['count'],
          maxLastUpdateAge: x['max_last_update_age'],
        } as VolunteerStat)
    );
  } finally {
    client.release();
  }
}

// Return a list of ThreadInfo's for all threads needing attention in a channel
export async function getThreadsNeedingAttentionForChannel(
  channelId: string
): Promise<ThreadInfo[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `WITH claims AS (
        SELECT
          user_id
          , volunteer_slack_user_id
          , volunteer_slack_user_name
          , row_number () OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
        FROM volunteer_voter_claims
        WHERE archived IS NOT TRUE
      )
      SELECT
        slack_parent_message_ts
        , slack_channel_id
        , t.user_id
        , EXTRACT(EPOCH FROM now() - updated_at) as last_update_age
        , c.volunteer_slack_user_id
        , c.volunteer_slack_user_name
        , t.history_ts
        , EXTRACT(EPOCH FROM t.session_start_at) as session_start_epoch
        , EXTRACT(EPOCH FROM t.session_end_at) as session_end_epoch
        FROM threads t, claims c
        WHERE
          needs_attention
          AND t.user_id=c.user_id
          AND c.rn=1
          AND slack_channel_id = $1
        ORDER BY updated_at`,
      [channelId]
    );
    return result.rows.map((x) => ({
      slackParentMessageTs: x['slack_parent_message_ts'],
      channelId: x['slack_channel_id'],
      userId: x['user_id'],
      lastUpdateAge: x['last_update_age'],
      volunteerSlackUserId: x['volunteer_slack_user_id'],
      volunteerSlackUserName: x['volunteer_slack_user_name'],
      historyTs: x['history_ts'],
      sessionStartEpoch: x['session_start_epoch'],
      sessionEndEpoch: x['session_end_epoch'],
    }));
  } finally {
    client.release();
  }
}

// Return a list of ThreadInfo's for all threads needing attention for a slack user
export async function getThreadsNeedingAttentionFor(
  slackUserId: string
): Promise<ThreadInfo[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `WITH claims AS (
        SELECT
          user_id
          , volunteer_slack_user_id
          , volunteer_slack_user_name
          , row_number () OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
        FROM volunteer_voter_claims
        WHERE archived IS NOT TRUE
      )
      SELECT
        slack_parent_message_ts
        , slack_channel_id
        , t.user_id
        , EXTRACT(EPOCH FROM now() - updated_at) as last_update_age
        , c.volunteer_slack_user_name
        , t.history_ts
        , EXTRACT(EPOCH FROM t.session_start_at) as session_start_epoch
        , EXTRACT(EPOCH FROM t.session_end_at) as session_end_epoch
        FROM threads t, claims c
        WHERE
          needs_attention
          AND t.user_id=c.user_id
          AND c.rn=1
          AND c.volunteer_slack_user_id=$1
        ORDER BY updated_at`,
      [slackUserId]
    );
    return result.rows.map((x) => ({
      slackParentMessageTs: x['slack_parent_message_ts'],
      channelId: x['slack_channel_id'],
      userId: x['user_id'],
      lastUpdateAge: x['last_update_age'],
      volunteerSlackUserId: slackUserId,
      volunteerSlackUserName: x['volunteer_slack_user_name'],
      historyTs: x['history_ts'],
      sessionStartEpoch: x['session_start_epoch'],
      sessionEndEpoch: x['session_end_epoch'],
    }));
  } finally {
    client.release();
  }
}

// Return the needs_attention status for a specific thread
export async function getThreadNeedsAttentionFor(
  slackParentMessageTs: string,
  slackChannelId: string
): Promise<boolean> {
  logger.info(`ENTERING DBAPIUTIL.getThreadNeedsAttentionFor`);
  logger.info(
    `DBAPIUTIL.getThreadNeedsAttentionFor: Looking up thread:${slackParentMessageTs}`
  );

  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT needs_attention FROM threads WHERE slack_parent_message_ts = $1 AND slack_channel_id = $2',
      [slackParentMessageTs, slackChannelId]
    );
    logger.info(
      `DBAPIUTIL.getMessageHistoryFor: Successfully looked up message history in PostgreSQL.`
    );
    if (result.rows.length > 0) {
      return result.rows[0].needs_attention;
    }
    return false;
  } finally {
    client.release();
  }
}

// Return a list of ThreadInfo's for all threads needing followup
export async function getThreadsNeedingFollowUp(
  slackUserId: string,
  days: number
): Promise<ThreadInfo[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `WITH latest_claims AS (
        SELECT DISTINCT ON (user_id) user_id, volunteer_slack_user_id, volunteer_slack_user_name, is_demo
        FROM volunteer_voter_claims
        WHERE archived IS NOT TRUE
        ORDER BY user_id, created_at DESC
      ), latest_statuses AS (
        SELECT DISTINCT ON (user_id) user_id, voter_status, is_demo
        FROM voter_status_updates
        ORDER BY user_id, created_at DESC
      )
      SELECT
        t.slack_parent_message_ts
        , t.slack_channel_id
        , t.user_id
        , t.history_ts
        , EXTRACT(EPOCH FROM now() - updated_at) as last_update_age
        , c.volunteer_slack_user_name
        , s.voter_status
        , EXTRACT(EPOCH FROM t.session_start_at) as session_start_epoch
        , EXTRACT(EPOCH FROM t.session_end_at) as session_end_epoch
        FROM threads t, latest_claims c, latest_statuses s
        WHERE
          active
          AND updated_at <= NOW() - interval '${days} days'
          AND t.user_id = c.user_id
          AND t.is_demo = c.is_demo
          AND c.volunteer_slack_user_id = $1
          AND s.user_id = t.user_id
          AND s.is_demo = t.is_demo
          AND t.archived IS NOT TRUE
        ORDER BY updated_at`,
      [slackUserId]
    );
    return result.rows.map((x) => ({
      slackParentMessageTs: x['slack_parent_message_ts'],
      channelId: x['slack_channel_id'],
      userId: x['user_id'],
      lastUpdateAge: x['last_update_age'],
      volunteerSlackUserId: slackUserId,
      volunteerSlackUserName: x['volunteer_slack_user_name'],
      voterStatus: x['voter_status'],
      historyTs: x['history_ts'],
      sessionStartEpoch: x['session_start_epoch'],
      sessionEndEpoch: x['session_end_epoch'],
    }));
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

export async function logInitialVoterStatusToDb(
  userId: string,
  userPhoneNumber: string,
  twilioPhoneNumber: string,
  isDemo: boolean
): Promise<void> {
  logger.info(`ENTERING DBAPIUTIL.logInitialVoterStatusToDb`);
  const client = await pool.connect();
  try {
    if (process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA') {
      // Only insert the UNKNOWN status if there is no existing status
      await client.query(
        `INSERT INTO voter_status_updates (user_id, user_phone_number, twilio_phone_number, voter_status, is_demo)
        SELECT $1, $2, $3, 'UNKNOWN', $4
        WHERE NOT EXISTS (
          SELECT null FROM voter_status_updates
          WHERE
            user_id = $1
            AND user_phone_number = $2
            AND twilio_phone_number = $3
            AND is_demo = $4
            AND archived IS NOT TRUE
        )`,
        [userId, userPhoneNumber, twilioPhoneNumber, isDemo]
      );
    } else {
      await client.query(
        `INSERT INTO voter_status_updates (user_id, user_phone_number, twilio_phone_number, voter_status, is_demo)
        VALUES ($1, $2, $3, 'UNKNOWN', $4)`,
        [userId, userPhoneNumber, twilioPhoneNumber, isDemo]
      );
    }
    logger.info(
      `DBAPIUTIL.logInitialVoterStatusToDb: Successfully inserted initial voter status into PostgreSQL database.`
    );
  } finally {
    client.release();
  }
}

const LAST_VOTER_STATUS_SQL_SCRIPT = `SELECT voter_status
                                        FROM voter_status_updates
                                        WHERE user_id = $1
                                          AND twilio_phone_number = $2
                                          AND archived IS NOT TRUE
                                        ORDER BY created_at DESC
                                        LIMIT 1;`;

// This function is used for the "Already Voted" functionality.
// History: This used to be used to look up the latest voter status when moving a voter
// from channel to channel, but now instead the voter status is coded into
// the block initial_option on the front-end, and is copied over with the blocks during the move.
export async function getLatestVoterStatus(
  userId: string,
  twilioPhoneNumber: string
): Promise<string | null> {
  logger.info(`ENTERING DBAPIUTIL.getLatest`);
  logger.info(
    `DBAPIUTIL.getLatestVoterStatus: Looking up last voter status for userId: ${userId}.`
  );
  const client = await pool.connect();

  try {
    const result = await client.query(LAST_VOTER_STATUS_SQL_SCRIPT, [
      userId,
      twilioPhoneNumber,
    ]);
    if (result.rows.length > 0) {
      logger.info(
        `DBAPIUTIL.getLatestVoterStatus: Successfully looked up last voter status.`
      );
      return result.rows[0].voter_status;
    } else {
      logger.error(
        `DBAPIUTIL.getLatestVoterStatus: No voter status for user: userId: ${userId}, twilioPhoneNumber: ${twilioPhoneNumber}`
      );
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
      'INSERT INTO volunteer_voter_claims (user_id, user_phone_number, twilio_phone_number, is_demo, volunteer_slack_user_name, volunteer_slack_user_id, originating_slack_user_name, originating_slack_user_id, slack_channel_name, slack_channel_id, slack_parent_message_ts, action_ts, archived) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, false);',
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

export async function getVoterHasVolunteer(userId: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT EXISTS(SELECT 1 FROM volunteer_voter_claims WHERE user_id = $1 AND archived IS NOT TRUE) AS exists',
      [userId]
    );
    return result.rows.length > 0 && result.rows[0]['exists'];
  } finally {
    client.release();
  }
}

export async function getKnownPhoneState(
  userPhoneNumber: string
): Promise<string | null> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT state FROM known_phone_states WHERE phone_number = $1',
      [userPhoneNumber]
    );
    return result.rows.length > 0 ? result.rows[0]['state'] : null;
  } catch (error) {
    logger.warn(`error querying known_phone_states: ${JSON.stringify(error)}`);
    return null;
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
