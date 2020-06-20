const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

exports.sendMessage = (message, options) => {
  twilioClient.messages
    .create({body: message,
       // from: process.env.TWILIO_PHONE_NUMBER,
       from: process.env.TWILIO_PHONE_NUMBER,
       to: options.userPhoneNumber})
    .then(response => console.log(`Successfully sent Twilio message ${response.sid}: ${message}.`));
}
