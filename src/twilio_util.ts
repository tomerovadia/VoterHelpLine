import express from 'express';
import twilio from 'twilio';

function requestFullURL(req: express.Request) {
  return `https://${req.headers.host}${req.url}`;
}

export function passesAuth(req: express.Request): boolean {
  const twilioSignature = req.headers['x-twilio-signature'];
  const params = req.body;
  const url = requestFullURL(req);

  return twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN!,
    twilioSignature as string,
    url,
    params
  );
}

export function twilioCallbackURL(req: express.Request): string {
  return `https://${req.headers.host}/twilio-callback`;
}
