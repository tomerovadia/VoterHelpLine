const getMessageSender = (messageObject, userId) => {
  switch (messageObject.direction) {
    case "INBOUND":
      return `${userId}:`;
    case "OUTBOUND":
      if (messageObject.automated) {
        return "Automated:";
      }
      return `Volunteer ${messageObject.originating_slack_user_id}:`;
    default:
      console.log("Error getting message sender: message is either INBOUND nor OUTBOUND");
  }

  return sender;
};

exports.formatMessageHistory = (messageObjects, userId) => {
  const formattedMessages = messageObjects.map(messageObject => {
    const timeSinceEpochSecs = Date.parse(messageObject.timestamp) / 1000;
    // See https://api.slack.com/reference/surfaces/formatting#visual-styles
    const specialSlackTimestamp = `*(<!date^${timeSinceEpochSecs}^{date_num} {time_secs}|${messageObject.timestamp}>)*`;
    const messageSender = `*${getMessageSender(messageObject, userId)}*`;
    return [specialSlackTimestamp, messageSender, messageObject.message].join(" ");
  });

  return formattedMessages.join("\n")
};
