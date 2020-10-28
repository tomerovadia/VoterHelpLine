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

export type TwilioRequestBody = {
  MessageSid: string;
  SmsMessageSid: string;
  AccountSid: string;
  MessagingServiceSid: string;
  From: string;
  To: string;
  Body: string;
  NumMedia: string;
} & {
  // Twilio also includes an arbitrary number of MediaContentType{N} and
  // MediaUrl{N} fields
  [mediaKey: string]: string | undefined;
};

/** Returns list of URLs for MMS attachments */
export function getAttachments(reqBody: TwilioRequestBody): string[] {
  const numMedia = Number(reqBody.NumMedia);

  if (numMedia === 0) {
    // no media to handle
    return [];
  }

  const mediaURLs: string[] = [];
  for (let i = 0; i < numMedia; i++) {
    const mediaKey = `MediaUrl${i}`;
    const url = reqBody[mediaKey];
    if (url) {
      mediaURLs.push(url);
    }
  }

  return mediaURLs;
}
