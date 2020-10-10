type SlackFile = {
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

export default {
  processMessageText(userMessage: string): string | null {
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

    // If nothing was changed, return null. Important for DB logging.
    return userMessage == processedUserMessage ? null : processedUserMessage;
  },

  getSlackAttachments(files: SlackFile[]): null | string[] {
    const supportedFiles = files.filter((file) =>
      SUPPORTED_MMS_MIME_TYPES.includes(file.mimetype)
    );

    if (supportedFiles.length === 0) {
      return [];
    }

    const totalSize = supportedFiles
      .map((file) => file.size)
      .reduce((a, b) => a + b, 0);

    // TODO: the file URLs are private. We probably need to give the bot
    // files:write access and then call https://api.slack.com/methods/files.sharedPublicURL
    //
    // But also the slack docs say that this endpoint is only for user tokens
    // and not for bot tokens?
    if (totalSize > MMS_MAX_SIZE) {
      // use thumbnails
      return supportedFiles.map((file) => file.thumb_360);
    } else {
      return supportedFiles.map((file) => file.url_private);
    }

    // TODO: might want to give some sort of feedback if we had to use the
    // scaled-down files, or filter any files out. Maybe add an emoji reaction?
  },
};
