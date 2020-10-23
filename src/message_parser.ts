import { EmojiConvertor } from 'emoji-js';
const emoji = new EmojiConvertor();

emoji.replace_mode = 'unified';
emoji.allow_native = true;

export type SlackFile = {
  id: string;
  created: number;
  timestamp: number;
  name: string;
  title: string;
  mimetype: string;
  filetype: string;
  pretty_type: string;
  user: string;
  editable: boolean;
  size: number;
  mode: string;
  is_external: boolean;
  external_type: string;
  is_public: boolean;
  public_url_shared: boolean;
  display_as_bot: boolean;
  username: string;
  url_private: string;
  url_private_download: string;
  thumb_64: string;
  thumb_80: string;
  thumb_360: string;
  thumb_360_w: number;
  thumb_360_h: number;
  thumb_480: string;
  thumb_160: string;
  original_w: number;
  original_h: number;
  thumb_tiny: string;
  permalink: string;
  permalink_public: string;
  has_rich_preview: boolean;
};

// From: https://www.twilio.com/docs/sms/accepted-mime-types#supported-mime-types
const SUPPORTED_MMS_MIME_TYPES = ['image/jpeg', 'image/gif', 'image/png'];

// Documented size limit is 5MB. To give us a bit of buffer, we assume they
// calculate MB with 1000 instead of 1024, and we limit to 90% of this
// hard cap.
const MMS_MAX_SIZE = 1000 * 1000 * 5 * 0.9;

export function processMessageText(userMessage: string): string | null {
  let processedUserMessage = userMessage;

  const doubleTelephoneNumbers = userMessage.matchAll(/<tel:(.*?)\|\1>/g);
  const arrayOfDoubleTelephoneNumbers = Array.from(doubleTelephoneNumbers);
  for (const i in arrayOfDoubleTelephoneNumbers) {
    const oldTelephoneNumber = arrayOfDoubleTelephoneNumbers[i][0];
    const newTelephoneNumber = arrayOfDoubleTelephoneNumbers[i][1];
    processedUserMessage = processedUserMessage.replace(
      oldTelephoneNumber,
      newTelephoneNumber
    );
  }

  const doubleLinks = userMessage.matchAll(/<(.*?)\|\1>/g);
  const arrayOfDoubleLinks = Array.from(doubleLinks);
  for (const i in arrayOfDoubleLinks) {
    const oldLink = arrayOfDoubleLinks[i][0];
    const newLink = arrayOfDoubleLinks[i][1];
    processedUserMessage = processedUserMessage.replace(oldLink, newLink);
  }

  const singleLinks = userMessage.matchAll(/<(.*?)>/g);
  const arrayOfSingleLinks = Array.from(singleLinks);
  for (const i in arrayOfSingleLinks) {
    const oldLink = arrayOfSingleLinks[i][0];
    const newLink = arrayOfSingleLinks[i][1];
    processedUserMessage = processedUserMessage.replace(oldLink, newLink);
  }

  // Replace emoji with unicode
  processedUserMessage = emoji.replace_colons(processedUserMessage);

  // If nothing was changed, return null. Important for DB logging.
  return userMessage == processedUserMessage ? null : processedUserMessage;
}

export function validateSlackAttachments(files: SlackFile[]): string[] {
  const errors = [] as string[];
  for (const file of files) {
    if (!SUPPORTED_MMS_MIME_TYPES.includes(file.mimetype)) {
      errors.push(`Attachment of type ${file.mimetype} not supported`);
    }
  }
  return errors;
}

export function getSlackAttachments(files: SlackFile[] | null): string[] {
  if (!files) {
    return [];
  }

  const totalSize = files.map((file) => file.size).reduce((a, b) => a + b, 0);

  const r = [] as string[];
  for (const file of files) {
    const comp = file.permalink_public.split('/');
    const bits = comp[3].split('-');
    const pub_secret = bits[2];
    if (totalSize > MMS_MAX_SIZE) {
      r.push(file.thumb_480 + '?pub_secret=' + pub_secret);
    } else {
      r.push(file.url_private + '?pub_secret=' + pub_secret);
    }
  }
  return r;
}
