import * as Sentry from '@sentry/node';
import logger from './logger';
import twilio from 'twilio';
import isFirstUseOfKey from './deduplication';

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export async function sendMessage(
  message: string,
  media: string[] | undefined,
  options: {
    twilioPhoneNumber: string;
    userPhoneNumber: string;
    twilioCallbackURL: string;
    deduplicationId?: string;
  }
): Promise<{
  success: boolean;
  sid?: string;
  errorMessage?: string;
  error?: {
    status?: number;
    message?: string;
    code?: number;
    more_info?: string;
  };
}> {
  logger.info(`ENTERING TWILIOAPIUTIL.sendMessage`);

  if (
    options.deduplicationId &&
    !(await isFirstUseOfKey(options.deduplicationId))
  ) {
    return {
      success: false,
      errorMessage: 'helpline_deduplication_filtered',
    };
  }

  try {
    logger.info(
      `TWILIOAPIUTIL.sendMessage: Including attachments ${JSON.stringify(
        media
      )}`
    );
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
    return {
      success: true,
      sid: response.sid,
    };
  } catch (error) {
    logger.error(`TWILIOAPIUTIL.sendMessage: ERROR in sending Twilio message,
      message: ${message},
      from: ${options.twilioPhoneNumber},
      to: ${options.userPhoneNumber}`);
    if (typeof error === 'object' && error !== null) {
      // checking if error is an object and is not null

      Sentry.captureException(error);

      return {
        success: false,
        errorMessage: 'twilio_error_with_error_object',
        error,
      };
    } else {
      return {
        success: false,
        errorMessage: 'twilio_error_without_error_object',
      };
    }
  }
}
