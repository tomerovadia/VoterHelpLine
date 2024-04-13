import type express from 'express';

export type MessageDirection = 'INBOUND' | 'OUTBOUND';
// TODO: Deprecate UNKNOWN EntryPoint.
export type EntryPoint = 'PULL' | 'PUSH' | 'UNKNOWN';
export type ChannelType = 'DEMO' | 'NORMAL';

// The status of a voter as determined by
// conversations with the voter.
export type VoterStatus =
  | 'UNKNOWN'
  | 'UNREGISTERED'
  | 'REGISTERED'
  | 'REQUESTED_BALLOT'
  | 'RECEIVED_BALLOT'
  | 'IN_PERSON'
  | 'VOTED'
  | 'NOT_VOTING'
  | 'REFUSED'
  | 'REJOIN'
  | 'SPAM';

// The status of a constituent for a particular
// API call. This is not the same as the voter status.
export enum ConstituentStatus {
  // Constituent status has not yet been determined.
  UNKNOWN = 'UNKNOWN',
  // This is the constituent's first message to us.
  // If their message qualifies them to be ENTERING,
  // their status will be ENTERING instead.
  NEW = 'NEW',
  // The constituent is engaging with the automated
  // system prior to entering the helpline.
  PRE_ENTERING_AUTOMATED = 'PRE_ENTERING_AUTOMATED',
  // The constituent should enter the helpline in this request.
  ENTERING = 'ENTERING',
  // The constituent has entered the helpline and the
  // automated system should handle replying to this request.
  HAS_ENTERED_AUTOMATED = 'HAS_ENTERED_AUTOMATED',
  // The constituent has entered the helpline and no
  // automated replies are active.
  HAS_ENTERED_CONVERSATION = 'HAS_ENTERED_CONVERSATION',
  // We know this voter, but this is their first message in a new cycle.
  RETURNING = 'RETURNING',
}

type UserInfoCore = {
  userId: string;
  confirmedDisclaimer: boolean;
  isDemo: boolean;
  lastVoterMessageSecsFromEpoch: number;
  entryPoint: EntryPoint;
  userPhoneNumber: string;
  activeChannelId: string;
  activeChannelName: string;
  volunteerEngaged: boolean;
  stateName: string | null;
  twilioPhoneNumber: string;
  numStateSelectionAttempts: number;
  sessionStartEpoch?: number;
  returningVoter?: boolean;
  panelMessage?: string;
};

type UserInfoChannels = {
  [channel: string]: string; // mapping of channel ID to message timestamp
};

export type UserInfo = UserInfoCore & UserInfoChannels;

export type HistoricalMessage = {
  timestamp: string;
  message: string;
  automated: boolean;
  direction: MessageDirection;
  originating_slack_user_name: string;
  slack_attachments: { id: string; permalink: string }[] | null;
  twilio_attachments: string[] | null;
};

export type SlackThreadInfo = {
  slackParentMessageTs: string;
  slackChannel: string;
};

export type Request = express.Request & { rawBody: string };

export const SessionTopics = {
  VERIFY: 'How to verify voter registration',
  REGISTER: 'How to register to vote',
  ABSENTEE_REQUEST: 'How to request an absentee ballot',
  ABSENTEE_BALLOT_DID_NOT_ARRIVE: 'Absentee ballot did not arrive',
  ABSENTEE_BALLOT_DAMAGED: 'Absentee ballot was damaged',
  ABSENTEE_BALLOT_MULTIPLE: 'Multiple absentee ballots arrived',
  ABSENTEE_BALLOT_RETURN: 'How to return a ballot',
  ABSENTEE_BALLOT_TRACK: 'How to track my ballot',
  WHERE_TO_VOTE: 'Where to vote',
  VOTE_EARLY: 'How to vote early',
  ABSENTEE_VOTE_IN_PERSON:
    'How to vote in person despite having absentee ballot',
  MOVED: 'Moved',
  UNUSUAL_QUESTION: 'Unusual and/or uncategorized question',
} as Record<string, string>;
