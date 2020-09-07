const VALID_COMMANDS = ["ROUTE_VOTER"];

exports.parseAdminSlackMessage = (message) => {
  let adminCommandParams = {};
  const words = message.split(" ");

  // Rules for all commands.
  if (words[0] != `<@${process.env.SLACK_BOT_USER_ID}>`
      || !VALID_COMMANDS.includes(words[1])) {
    return null;
  }

  // Rules for ROUTE_VOTER command.
  if (words[1] === "ROUTE_VOTER"
      && words.length !== 4) {
    return null;
  }

  return {
    command: words[1],
    userId: words[2],
    destinationChannel: words[3],
  };
};
