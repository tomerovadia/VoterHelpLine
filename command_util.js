const MessageParser = require('./message_parser');

const ROUTE_VOTER = "ROUTE_VOTER";
const UPDATE_VOTER_STATUS = "UPDATE_VOTER_STATUS";
const FIND_VOTER = "FIND_VOTER";
const RESET_VOTER = "RESET_VOTER";
const VALID_COMMANDS = [ROUTE_VOTER, UPDATE_VOTER_STATUS];
exports.ROUTE_VOTER = ROUTE_VOTER;
exports.FIND_VOTER = FIND_VOTER;
exports.RESET_VOTER = RESET_VOTER;

const getValidVoterStatuses = () => {
  switch (process.env.CLIENT_ORGANIZATION) {
    case "VOTER_HELP_LINE":
      return ["UNKNOWN", "NO_APPLICATION", "APPLICATION_REQUESTED", "APPLICATION_RECEIVED", "BALLOT_REQUESTED", "BALLOT_RECEIVED", "VOTED"];
    case "VOTE_FROM_HOME_2020":
      return ["UNKNOWN", "NO_APPLICATION", "APPLICATION_REQUESTED", "APPLICATION_RECEIVED", "BALLOT_REQUESTED", "BALLOT_RECEIVED", "VOTED"];
    default:
      return ["UNKNOWN", "NO_APPLICATION", "APPLICATION_REQUESTED", "APPLICATION_RECEIVED", "BALLOT_REQUESTED", "BALLOT_RECEIVED", "VOTED"];
    }
};

const compileRouteVoterCommandArgs = (words) => {
  if (words.length !== 5) {
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

const compileUpdateVoterStatusCommandArgs = (words) => {
  if (words.length !== 4 || !getValidVoterStatuses().includes(words[3])) {
    return null;
  }

  return {
    command: words[1],
    userId: words[2],
    voterStatus: words[3],
  };
};

exports.parseSlackCommand = (message) => {
  const words = message.split(/\s+/);

  // Rules for all commands.
  if (words[0] != `<@${process.env.SLACK_BOT_USER_ID}>`
      || !VALID_COMMANDS.includes(words[1])) {
    return null;
  }

  const command = words[1];

  switch(command) {
    case ROUTE_VOTER:
      return compileRouteVoterCommandArgs(words);
    case UPDATE_VOTER_STATUS:
      return compileUpdateVoterStatusCommandArgs(words);
    default:
      // This should never be relevant because of the valid command check above.
      return null;
  }
};

exports.findVoter = () => {

};

exports.resetVoter = () => {

};
