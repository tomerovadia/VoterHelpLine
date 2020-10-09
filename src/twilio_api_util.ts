import * as Sentry from '@sentry/node';
import * as DbApiUtil from './db_api_util';
import logger from './logger';
import twilio from 'twilio';
import isFirstUseOfKey from './deduplication';

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
  databaseMessageEntry?: DbApiUtil.DatabaseMessageEntry
): Promise<void> {
  logger.info(`ENTERING TWILIOAPIUTIL.sendMessage`);

  if (databaseMessageEntry) {
    logger.info(
      `TWILIOAPIUTIL.sendMessage: This Twilio message send will log to DB (databaseMessageEntry is not null).`
    );
    databaseMessageEntry.message = message;
    databaseMessageEntry.fromPhoneNumber = options.twilioPhoneNumber;
    databaseMessageEntry.toPhoneNumber = options.userPhoneNumber;
    databaseMessageEntry.twilioSendTimestamp = new Date();
  }

  if (
    options.deduplicationId &&
    !(await isFirstUseOfKey(options.deduplicationId))
  ) {
    if (databaseMessageEntry) {
      logger.warn(
        'TWILIOAPIUTIL.sendMessage: Not sending duplicate Twilio message ' +
          `triggered by Slack message ${databaseMessageEntry.slackMessageTs} in ` +
          `channel ${databaseMessageEntry.slackChannel} to ${options.userPhoneNumber}: ${message}`
      );

      databaseMessageEntry.successfullySent = false;
      databaseMessageEntry.twilioError = 'helpline_deduplication_filtered';

      try {
        await DbApiUtil.logMessageToDb(databaseMessageEntry);
      } catch (error) {
        logger.error(
          'TWILIOAPIUTIL.sendMessage: failed to log message send duplication failure to DB'
        );
        Sentry.captureException(error);
      }
    } else {
      logger.warn(
        `TWILIOAPIUTIL.sendMessage: Not sending duplicate Twilio message to ${options.userPhoneNumber}: ${message}`
      );
    }

    return;
  }

  try {
    const response = await twilioClient.messages.create({
      body: message,
      from: options.twilioPhoneNumber,
      to: options.userPhoneNumber,
      statusCallback: options.twilioCallbackURL,
    });

    logger.info(`TWILIOAPIUTIL.sendMessage: Successfully sent Twilio message,
                  response.sid: ${response.sid},
                  message: ${message},
                  from: ${options.twilioPhoneNumber},
                  to: ${options.userPhoneNumber}\n`);

    if (databaseMessageEntry) {
      databaseMessageEntry.twilioMessageSid = response.sid;
      databaseMessageEntry.successfullySent = true;

      try {
        await DbApiUtil.logMessageToDb(databaseMessageEntry);
      } catch (error) {
        logger.error(
          'TWILIOAPIUTIL.sendMessage: failed to log message send success to DB'
        );
        Sentry.captureException(error);
      }
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

    if (databaseMessageEntry) {
      // TODO: populate twilioMessageSid, which exists even for unsuccessful sends
      // Not sure how to find it.
      databaseMessageEntry.successfullySent = false;
      databaseMessageEntry.twilioError = twilioError;

      try {
        await DbApiUtil.logMessageToDb(databaseMessageEntry);
      } catch (error) {
        logger.error(
          'TWILIOAPIUTIL.sendMessage: failed to log message send failure to DB'
        );
        Sentry.captureException(error);
      }
    }

    throw error;
  }
}
