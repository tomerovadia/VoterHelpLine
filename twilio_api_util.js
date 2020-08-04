let twilioClient;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

exports.sendMessage = (message, options) => {
  twilioClient.messages
    .create({body: message,
       from: options.twilioPhoneNumber,
       to: options.userPhoneNumber})
    .then(response => console.log(`Successfully sent Twilio message ${response.sid}: ${message}`));
};
