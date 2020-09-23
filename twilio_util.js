const twilio = require('twilio');

exports.passesAuth = (req) => {
  const twilioSignature = req.headers['x-twilio-signature'];
  const params = req.body;
  const url = `https://${req.headers.host}${req.url}`;

  return twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    twilioSignature,
    url,
    params
  );
};
