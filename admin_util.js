const MessageParser = require('./message_parser');

const ROUTE_VOTER = "ROUTE_VOTER";
const FIND_VOTER = "FIND_VOTER";
const RESET_VOTER = "RESET_VOTER";
const VALID_COMMANDS = [ROUTE_VOTER, FIND_VOTER, RESET_VOTER];
exports.ROUTE_VOTER = ROUTE_VOTER;
exports.FIND_VOTER = FIND_VOTER;
exports.RESET_VOTER = RESET_VOTER;

exports.parseAdminSlackMessage = (message) => {
  let adminCommandParams = {};
  const words = message.split(/\s+/);

  // Rules for all commands.
  if (words[0] != `<@${process.env.SLACK_BOT_USER_ID}>`
      || !VALID_COMMANDS.includes(words[1])) {
    return null;
  }

  // Rules for ROUTE_VOTER command.
  if (words[1] === "ROUTE_VOTER"
      && words.length !== 5) {
    return null;
  }

  // Parsing necessary because phone numbers are converted to links in Slack
  // and sent as e.g. <tel:+18551234567|+18551234567>.
  const parsedTwilioPhoneNumber = MessageParser.processMessageText(words[3]);

  return {
    command: words[1],
    userId: words[2],
    // Ternary is necessary because MessageParser returns null if unchanged,
    // which is necessary for its other use case (to know if a message was modified
    // so the DB write can indicate this).
    twilioPhoneNumber: parsedTwilioPhoneNumber ? parsedTwilioPhoneNumber : words[3],
    destinationSlackChannelName: words[4],
  };
};

exports.findVoter = () => {
  
};

exports.resetVoter = () => {

};
