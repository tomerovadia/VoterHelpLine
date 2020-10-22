import * as Sentry from '@sentry/node';
import * as DbApiUtil from './db_api_util';
import logger from './logger';
import twilio from 'twilio';
import isFirstUseOfKey from './deduplication';
import MessageParser from './message_parser';

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export async function sendMessage(
  message: string,
  options: {
    twilioPhoneNumber: string;
    userPhoneNumber: string;
    twilioCallbackURL: string;
    deduplicationId?: string;
  },
  databaseMessageEntry: DbApiUtil.DatabaseMessageEntry
): Promise<void> {
  logger.info(`ENTERING TWILIOAPIUTIL.sendMessage`);

  databaseMessageEntry.message = message;
  databaseMessageEntry.fromPhoneNumber = options.twilioPhoneNumber;
  databaseMessageEntry.toPhoneNumber = options.userPhoneNumber;
  databaseMessageEntry.twilioSendTimestamp = new Date();

  if (
    options.deduplicationId &&
    !(await isFirstUseOfKey(options.deduplicationId))
  ) {
    logger.warn(
      'TWILIOAPIUTIL.sendMessage: Not sending duplicate Twilio message ' +
        `triggered by Slack message ${databaseMessageEntry.slackMessageTs} in ` +
        `channel ${databaseMessageEntry.slackChannel} to ${options.userPhoneNumber}: ${message}`
    );

    databaseMessageEntry.successfullySent = false;
    databaseMessageEntry.twilioError = 'helpline_deduplication_filtered';

    try {
      await DbApiUtil.logMessageToDb(databaseMessageEntry);
      if (databaseMessageEntry.slackParentMessageTs) {
        await DbApiUtil.updateThreadStatusFromMessage(databaseMessageEntry);
      }
    } catch (error) {
      logger.error(
        'TWILIOAPIUTIL.sendMessage: failed to log message send duplication failure to DB'
      );
      Sentry.captureException(error);
    }

    return;
  }

  try {
    let media = [] as string[];
    if (databaseMessageEntry.slackFiles) {
      media = MessageParser.getSlackAttachments(
        databaseMessageEntry.slackFiles
      );
      logger.info(`Including attachments ${JSON.stringify(media)}`);
    }
    const response = await twilioClient.messages.create({
      body: message,
      from: options.twilioPhoneNumber,
      to: options.userPhoneNumber,
      statusCallback: options.twilioCallbackURL,
      mediaUrl: media,
    });

    logger.info(`TWILIOAPIUTIL.sendMessage: Successfully sent Twilio message,
                  response.sid: ${response.sid},
                  message: ${message},
                  from: ${options.twilioPhoneNumber},
                  to: ${options.userPhoneNumber}\n`);

    databaseMessageEntry.twilioMessageSid = response.sid;
    databaseMessageEntry.successfullySent = true;

    try {
      await DbApiUtil.logMessageToDb(databaseMessageEntry);
      if (databaseMessageEntry.slackParentMessageTs) {
        await DbApiUtil.updateThreadStatusFromMessage(databaseMessageEntry);
      }
    } catch (error) {
      logger.error(
        'TWILIOAPIUTIL.sendMessage: failed to log message send success to DB'
      );
      Sentry.captureException(error);
    }
  } catch (error) {
    logger.error(`TWILIOAPIUTIL.sendMessage: ERROR in sending Twilio message,
                  message: ${message},
                  from: ${options.twilioPhoneNumber},
                  to: ${options.userPhoneNumber}`);
    const twilioError = `Status: ${error.status ? error.status : ''}, Message:${
      error.message ? error.message : ''
    }, Code: ${error.code ? error.code : ''}, More Info: ${
      error.more_info ? error.more_info : ''
    }`;
    logger.error(
      `TWILIOAPIUTIL.sendMessage: ERROR in sending Twilio message. Error data from Twilio: ${twilioError}`
    );
    Sentry.captureException(error);

    // TODO: populate twilioMessageSid, which exists even for unsuccessful sends
    // Not sure how to find it.
    databaseMessageEntry.successfullySent = false;
    databaseMessageEntry.twilioError = twilioError;

    try {
      await DbApiUtil.logMessageToDb(databaseMessageEntry);
      if (databaseMessageEntry.slackParentMessageTs) {
        await DbApiUtil.updateThreadStatusFromMessage(databaseMessageEntry);
      }
    } catch (error) {
      logger.error(
        'TWILIOAPIUTIL.sendMessage: failed to log message send failure to DB'
      );
      Sentry.captureException(error);
    }

    throw error;
  }
}
