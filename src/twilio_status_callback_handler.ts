import { logTwilioStatusToDb } from './db_api_util';
import logger from './logger';
import { addSlackMessageReaction } from './slack_api_util';
import { Request } from './types';

// Twilio statuses that represent the final state of a message. The value
// in this map is the emoji reaction to add to the Slack message.
const SMS_FINAL_STATUSES: { [status: string]: string } = {
  delivered: 'white_check_mark',
  undelivered: 'x',
  failed: 'x',
};
const MMS_FINAL_STATUSES: { [status: string]: string } = {
  sent: 'white_check_mark',
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
  let reaction = null;
  if (messageSid.substr(0, 2) === 'MM') {
    if (!(messageStatus in MMS_FINAL_STATUSES)) {
      logger.info(`Twilio MMS status is non-final; not processing`);
      return;
    }
    reaction = MMS_FINAL_STATUSES[messageStatus];
  } else {
    if (!(messageStatus in SMS_FINAL_STATUSES)) {
      logger.info(`Twilio SMS status is non-final; not processing`);
      return;
    }
    reaction = SMS_FINAL_STATUSES[messageStatus];
  }

  // Update the Postgres DB with the message status and current timestamp
  const slackMessageInfo = await logTwilioStatusToDb(messageSid, messageStatus);
  if (!slackMessageInfo) {
    logger.error(
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
    reaction
  );
}
