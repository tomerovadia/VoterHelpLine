import type express from 'express';

export type MessageDirection = 'INBOUND' | 'OUTBOUND';
export type EntryPoint = 'PULL' | 'PUSH';
export type VoterStatus =
  | 'UNKNOWN'
  | 'UNREGISTERED'
  | 'REGISTERED'
  | 'REQUESTED_BALLOT'
  | 'RECEIVED_BALLOT'
  | 'IN_PERSON'
  | 'VOTED'
  | 'REFUSED'
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
};

type UserInfoChannels = {
  [channel: string]: number; // mapping of channel ID to message timestamp
};

export type UserInfo = UserInfoCore & UserInfoChannels;

export type HistoricalMessage = {
  timestamp: string;
  message: string;
  automated: boolean;
  direction: MessageDirection;
  originating_slack_user_name: string;
};

export type Request = express.Request & { rawBody: string };
