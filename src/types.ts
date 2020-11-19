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
  numStateSelectionAttempts: number;
  sessionStartEpoch?: number;
  returningVoter?: boolean;
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
