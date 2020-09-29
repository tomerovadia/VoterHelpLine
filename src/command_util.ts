import MessageParser from './message_parser';
import { PromisifiedRedisClient } from './redis_client';

export type AdminCommand =
  | 'ROUTE_VOTER'
  | 'UPDATE_VOTER_STATUS'
  | 'FIND_VOTER'
  | 'RESET_VOTER';

export const ROUTE_VOTER = 'ROUTE_VOTER';
export const UPDATE_VOTER_STATUS = 'UPDATE_VOTER_STATUS';
export const FIND_VOTER = 'FIND_VOTER';
export const RESET_VOTER = 'RESET_VOTER';
export const VALID_COMMANDS: AdminCommand[] = [
  ROUTE_VOTER,
  UPDATE_VOTER_STATUS,
];

// TODO: should this be the same as the VoterStatus in db_api_util? It doesn't
// appear to match the definition of the voter_status enum in Postgres
export type VoterStatus =
  | 'UNKNOWN'
  | 'NO_APPLICATION'
  | 'APPLICATION_REQUESTED'
  | 'APPLICATION_RECEIVED'
  | 'BALLOT_REQUESTED'
  | 'BALLOT_RECEIVED'
  | 'VOTED';

const getValidVoterStatuses = (): VoterStatus[] => {
  switch (process.env.CLIENT_ORGANIZATION) {
    case 'VOTER_HELP_LINE':
      return [
        'UNKNOWN',
        'NO_APPLICATION',
        'APPLICATION_REQUESTED',
        'APPLICATION_RECEIVED',
        'BALLOT_REQUESTED',
        'BALLOT_RECEIVED',
        'VOTED',
      ];
    case 'VOTE_FROM_HOME_2020':
      return [
        'UNKNOWN',
        'NO_APPLICATION',
        'APPLICATION_REQUESTED',
        'APPLICATION_RECEIVED',
        'BALLOT_REQUESTED',
        'BALLOT_RECEIVED',
        'VOTED',
      ];
    default:
      return [
        'UNKNOWN',
        'NO_APPLICATION',
        'APPLICATION_REQUESTED',
        'APPLICATION_RECEIVED',
        'BALLOT_REQUESTED',
        'BALLOT_RECEIVED',
        'VOTED',
      ];
  }
};

export type ParsedCommandRouteVoter = {
  command: typeof ROUTE_VOTER;
  userId: string;
  twilioPhoneNumber: string;
  destinationSlackChannelName: string;
};

export type ParsedCommandUpdateVoterStatus = {
  command: typeof UPDATE_VOTER_STATUS;
  userId: string;
  voterStatus: VoterStatus;
};

export type ParsedCommandFindVoter = {
  command: typeof FIND_VOTER;
  voterIdentifier: string;
};

export type ParsedCommandResetVoter = {
  command: typeof RESET_VOTER;
  userId: string;
  twilioPhoneNumber: string;
};

export type ParsedCommand =
  | ParsedCommandRouteVoter
  | ParsedCommandUpdateVoterStatus
  | ParsedCommandFindVoter
  | ParsedCommandResetVoter;

const compileRouteVoterCommandArgs = (
  args: string[]
): null | ParsedCommandRouteVoter => {
  if (args.length !== 3) {
    return null;
  }

  // Parsing necessary because phone numbers are converted to links in Slack
  // and sent as e.g. <tel:+18551234567|+18551234567>.
  const parsedTwilioPhoneNumber = MessageParser.processMessageText(args[1]);

  return {
    command: ROUTE_VOTER,
    userId: args[0],
    // Ternary is necessary because MessageParser returns null if unchanged,
    // which is necessary for its other use case (to know if a message was modified
    // so the DB write can indicate this).
    twilioPhoneNumber: parsedTwilioPhoneNumber
      ? parsedTwilioPhoneNumber
      : args[1],
    destinationSlackChannelName: args[2],
  };
};

const isVoterStatus = (word: string): word is VoterStatus => {
  return getValidVoterStatuses().includes(word as VoterStatus);
};

const compileUpdateVoterStatusCommandArgs = (
  args: string[]
): null | ParsedCommandUpdateVoterStatus => {
  if (args.length !== 2 || !isVoterStatus(args[1])) {
    return null;
  }

  return {
    command: UPDATE_VOTER_STATUS,
    userId: args[0],
    voterStatus: args[1],
  };
};

const isValidCommand = (word: string): word is AdminCommand => {
  return VALID_COMMANDS.includes(word as AdminCommand);
};

export function parseSlackCommand(message: string): ParsedCommand | null {
  const words = message.split(/\s+/);

  const [botUserId, command, ...args] = words;

  // Rules for all commands.
  if (
    botUserId != `<@${process.env.SLACK_BOT_USER_ID}>` ||
    !isValidCommand(command)
  ) {
    return null;
  }

  switch (command) {
    case ROUTE_VOTER:
      return compileRouteVoterCommandArgs(args);
    case UPDATE_VOTER_STATUS:
      return compileUpdateVoterStatusCommandArgs(args);
    default:
      // This should never be relevant because of the valid command check above.
      return null;
  }
}

export async function findVoter(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  redisClient: PromisifiedRedisClient,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  voterIdentifier: string
): Promise<void> {}

export async function resetVoter(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  redisClient: PromisifiedRedisClient,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  twilioPhoneNumber: string
): Promise<void> {}
