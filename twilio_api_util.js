const DbApiUtil = require('./db_api_util');

let twilioClient;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

exports.sendMessage = (message, options, databaseMessageEntry) => {
  if (databaseMessageEntry) {
    databaseMessageEntry.message = message;
    databaseMessageEntry.fromPhoneNumber = options.twilioPhoneNumber;
    databaseMessageEntry.toPhoneNumber = options.userPhoneNumber;
    databaseMessageEntry.twilioSendTimestamp = new Date();
  }

  return twilioClient.messages
    .create({body: message,
       from: options.twilioPhoneNumber,
       to: options.userPhoneNumber})
    .then(response => {
      console.log(`\n\nSuccessfully sent Twilio message ${response.sid}: ${message}`);
      if (databaseMessageEntry) {
        databaseMessageEntry.twilioMessageSid = response.sid;
        databaseMessageEntry.successfullySent = true;
        DbApiUtil.logMessageToDb(databaseMessageEntry);
      }
    })
    .catch(error => {
      console.log(error);
      if (databaseMessageEntry) {
        // TODO: populate twilioMessageSid, which exists even for unsuccessful sends
        // Not sure how to find it.
        databaseMessageEntry.successfullySent = false;
        databaseMessageEntry.twilioError = `Status: ${error.status ? error.status : ""}, Message:${error.message ? error.message : ""}, Code: ${error.code ? error.code : ""}, More Info: ${error.more_info ? error.more_info : ""}`
        DbApiUtil.logMessageToDb(databaseMessageEntry);
      }
      return error;
    });
};
