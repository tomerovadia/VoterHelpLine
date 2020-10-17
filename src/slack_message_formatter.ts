import { HistoricalMessage } from './types';
import logger from './logger';

const formatMessageBlock = (msg: string, formatchar: string) => {
  return msg
    .split('\n')
    .map((x) => (x ? formatchar + x + formatchar : x))
    .map((x) => '>' + x)
    .join('\n');
};

export function formatMessageHistory(
  messageObjects: HistoricalMessage[],
  userId: string
): string {
  logger.info('ENTERING SLACKMESSAGEFORMATTER.formatMessageHistory');
  const formattedMessages = messageObjects.map((messageObject) => {
    const timeSinceEpochSecs = Date.parse(messageObject.timestamp) / 1000;
    // See https://api.slack.com/reference/surfaces/formatting#visual-styles
    const specialSlackTimestamp = `<!date^${timeSinceEpochSecs}^{time} {date_short}|${messageObject.timestamp}>`;
    if (messageObject.direction == 'INBOUND') {
      return (
        `:bust_in_silhouette: *Voter ${userId}*  ` +
        specialSlackTimestamp +
        '\n' +
        formatMessageBlock(messageObject.message, '*')
      );
    } else if (messageObject.automated) {
      return (
        ':gear: *Helpline*  ' +
        specialSlackTimestamp +
        '\n' +
        formatMessageBlock(messageObject.message, '_')
      );
    } else {
      return (
        ':adult: *Helpline*  ' +
        specialSlackTimestamp +
        '\n' +
        formatMessageBlock(messageObject.message, '')
      );
    }
  });

  return formattedMessages.join('\n\n');
}
