import type express from 'express';

export type MessageDirection = 'INBOUND' | 'OUTBOUND';
export type EntryPoint = 'PULL' | 'PUSH';
export type ChannelType = 'DEMO' | 'NORMAL';
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
  UNUSUAL_QUESTION: 'Unusual and/or uncategorized question',
} as Record<string, string>;
