import { logTwilioStatusToDb } from './db_api_util';
import logger from './logger';
import { addSlackMessageReaction } from './slack_api_util';
import { Request } from './types';

// Twilio statuses that represent the final state of a message. The value
// in this map is the emoji reaction to add to the Slack message.
const FINAL_STATUSES: { [status: string]: string } = {
  delivered: 'white_check_mark',
  undelivered: 'x',
  failed: 'x',
};

export async function handleTwilioStatusCallback(req: Request): Promise<void> {
  const { MessageStatus: messageStatus, MessageSid: messageSid } = req.body;

  logger.info(
    `HANDLING TWILIO CALLBACK: message sid ${messageSid} has status ${messageStatus}`
  );

  // Twilio delivers callbacks for lots of intermediate states (queued, sent
  // to carrier, etc.). We just care about the final status of the message,
  // so we don't update Postgres for those intermediate statuses.
  if (!(messageStatus in FINAL_STATUSES)) {
    logger.info(`Twilio status is non-final; not processing`);
    return;
  }

  // Update the Postgres DB with the message status and current timestamp
  const slackMessageInfo = await logTwilioStatusToDb(messageSid, messageStatus);
  if (!slackMessageInfo) {
    logger.info(
      `TWILIO STATUS CALLBACK: No message with sid ${messageSid}; not updating slack`
    );
    return;
  }

  if (!slackMessageInfo.slackChannel || !slackMessageInfo.slackMessageTs) {
    logger.info(
      `Message SID ${messageSid} corresponds to a message without a slack message; not updating slack`
    );
    return;
  }

  // Update the slack message to indicate success/failure
  await addSlackMessageReaction(
    slackMessageInfo.slackChannel,
    slackMessageInfo.slackMessageTs,
    FINAL_STATUSES[messageStatus]
  );
}
