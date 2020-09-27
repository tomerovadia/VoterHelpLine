const Sentry = require('@sentry/node');
const DbApiUtil = require('./db_api_util');

let twilioClient;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

exports.sendMessage = async (message, options, databaseMessageEntry) => {
  console.log(`\nENTERING TWILIOAPIUTIL.sendMessage`);
  if (databaseMessageEntry) {
    console.log(`TWILIOAPIUTIL.sendMessage: This Twilio message send will log to DB (databaseMessageEntry is not null).`);
    databaseMessageEntry.message = message;
    databaseMessageEntry.fromPhoneNumber = options.twilioPhoneNumber;
    databaseMessageEntry.toPhoneNumber = options.userPhoneNumber;
    databaseMessageEntry.twilioSendTimestamp = new Date();
  }

  try {
    const response = await twilioClient.messages.create({
      body: message,
      from: options.twilioPhoneNumber,
      to: options.userPhoneNumber,
    });

    console.log(`TWILIOAPIUTIL.sendMessage: Successfully sent Twilio message,
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
        console.log('TWILIOAPIUTIL.sendMessage: failed to log message send success to DB');
        Sentry.captureException(error);
      }
    }
  } catch (error) {
    console.log('\x1b[41m%s\x1b[1m\x1b[0m', `TWILIOAPIUTIL.sendMessage: ERROR in sending Twilio message,
                  message: ${message},
                  from: ${options.twilioPhoneNumber},
                  to: ${options.userPhoneNumber}`);
    const twilioError = `Status: ${error.status ? error.status : ""}, Message:${error.message ? error.message : ""}, Code: ${error.code ? error.code : ""}, More Info: ${error.more_info ? error.more_info : ""}`;
    console.log('\x1b[41m%s\x1b[1m\x1b[0m', `TWILIOAPIUTIL.sendMessage: ERROR in sending Twilio message. Error data from Twilio: ${twilioError}`);
    Sentry.captureException(error);

    if (databaseMessageEntry) {
      // TODO: populate twilioMessageSid, which exists even for unsuccessful sends
      // Not sure how to find it.
      databaseMessageEntry.successfullySent = false;
      databaseMessageEntry.twilioError = twilioError;

      try {
        await DbApiUtil.logMessageToDb(databaseMessageEntry);
      } catch (error) {
        console.log('TWILIOAPIUTIL.sendMessage: failed to log message send failure to DB');
        Sentry.captureException(error);
      }
    }

    throw error;
  }
};
