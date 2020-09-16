const logDebug = process.env.NODE_ENV !== "test";

const getMessageSender = (messageObject, userId) => {
  switch (messageObject.direction) {
    case "INBOUND":
      return `${userId}:`;
    case "OUTBOUND":
      if (messageObject.automated) {
        return "Automated:";
      }
      return `${messageObject.originating_slack_user_name}:`;
    default:
      if (logDebug) console.log('\x1b[41m%s\x1b[1m\x1b[0m', "SLACKMESSAGEFORMATTER.formatMessageHistory: Error getting message sender: message is either INBOUND nor OUTBOUND");
  }

  return sender;
};

exports.formatMessageHistory = (messageObjects, userId) => {
  if (logDebug) console.log("\nENTERING SLACKMESSAGEFORMATTER.formatMessageHistory");
  const formattedMessages = messageObjects.map(messageObject => {
    const timeSinceEpochSecs = Date.parse(messageObject.timestamp) / 1000;
    // See https://api.slack.com/reference/surfaces/formatting#visual-styles
    const specialSlackTimestamp = `*(<!date^${timeSinceEpochSecs}^{date_num} {time_secs}|${messageObject.timestamp}>)*`;
    const messageSender = `*${getMessageSender(messageObject, userId)}*`;
    return [specialSlackTimestamp, messageSender, messageObject.message].join(" ");
  });

  return formattedMessages.join("\n")
};
