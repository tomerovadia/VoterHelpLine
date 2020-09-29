import express from 'express';
import twilio from 'twilio';

export function passesAuth(req: express.Request): boolean {
  const twilioSignature = req.headers['x-twilio-signature'];
  const params = req.body;
  const url = `https://${req.headers.host}${req.url}`;

  return twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN!,
    twilioSignature as string,
    url,
    params
  );
}
