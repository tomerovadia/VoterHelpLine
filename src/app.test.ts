import request from 'supertest';

import {
  mockTopLevelThreadSlackOptions,
  mockConstituentPhoneNumber,
  mockConstituentId,
  mockThreadInfos,
  mockThreadInfoChannelId1,
  mockThreadInfoChannelId2,
  mockThreadInfoChannelName1,
  mockThreadInfoChannelName2,
  mockHistoricalMessages,
} from './test_constants'

const mockTwilioPhoneNumber = 'mockTwilioPhoneNumber';
const mockConstituentMessage = 'mockConstituentMessage';
const mockInboundSmsMessageSid = 'mockInboundSmsMessageSid';
const mockOutboundSmsMessageSid = 'mockOutboundSmsMessageSid';
const mockSlackChannelId = 'mockSlackChannelId';
const nonExistentLobbySlackChannelId = 'NONEXISTENT_LOBBY';
const nonExistentLobbySlackParentThreadTs = 'NONEXISTENT_LOBBY_TS';
const mockSlackParentThreadTs = 'mockSlackParentThreadTs';
const mockSlackNestedMessageTs = 'mockSlackNestedMessageTs';
const mockTopLevelThreadSlackMessage = `<!channel> New voter\n${mockConstituentId} via ${mockTwilioPhoneNumber}`;

jest.mock('./twilio_util', () => ({
  twilioCallbackURL: jest.fn(),
  getAttachments: jest.fn().mockReturnValue([]),
  passesAuth: jest.fn().mockReturnValue(true),
}));

jest.mock('./slack_api_util', () => ({
  ...jest.requireActual('./slack_api_util'),
  sendMessage: jest.fn(),
  getThreadPermalink: jest.fn().mockReturnValue('mockThreadPermalink'),
}));

jest.mock('./twilio_api_util_refactored', () => ({
  sendMessage: jest.fn().mockReturnValue({
    success: true,
    sid: mockOutboundSmsMessageSid,
  }),
}));

jest.mock('./redis_api_util', () => ({
  setHash: jest.fn(),
  getHash: jest.fn() as jest.Mock<Promise<{[k: string]: any;}>>,
  getHashField: jest.fn(),
  deleteHashField: jest.fn(),
  getKey: jest.fn(),
  keysExist: jest.fn(),
  deleteKeys: jest.fn(),
  transactAsync: jest.fn(),
}));

jest.mock('./db_api_util', () => ({
  ...jest.requireActual('./db_api_util'),
  logMessageToDb: jest.fn(),
  logInitialVoterStatusToDb: jest.fn(),
  getLatestVoterStatus: jest.fn(),
  getVoterVolunteer: jest.fn(),
  getThreadTopics: jest.fn(),
  logThreadToDb: jest.fn(),
  getMessageHistoryFor: jest.fn(),
  setThreadHistoryTs: jest.fn(),
  getPastSessionThreads: jest.fn().mockResolvedValue(mockThreadInfos),
}));

jest.mock('./config', () => {
  return {
    "enableMultiCycleFeature": false,
    "numStateSelectionAttemptsLimit": 2,
    "useRefactoredPath": true,
    "enableKnownStateFromPhoneNumber": false,
    "skipLobby": true,
  }
});

import * as TwilioUtil from './twilio_util';
import * as RedisApiUtil from './redis_api_util';
import * as DbApiUtil from './db_api_util';
import config from './config';

process.env.CLIENT_ORGANIZATION = 'VOTE_AMERICA';
process.env.TEAM_ID = 'T123456';

async function sendAndExpectSuccessForHelplineRequest(app: any) {
  await request(app)
    .post('/twilio-pull')
    .send({
      From: mockConstituentPhoneNumber,
      To: mockTwilioPhoneNumber,
      Body: "HELPLINE",
      SmsMessageSid: mockInboundSmsMessageSid
    })
    .expect(200)
    .expect('Content-Type', "text/xml");
};

describe('POST /twilio-pull', () => {
  let TwilioApiUtil2: { sendMessage: any; };
  let SlackApiUtil: { sendMessage: any; };
  let app: any;
  beforeAll(() => {
    TwilioApiUtil2 = require('./twilio_api_util_refactored');
    SlackApiUtil = require('./slack_api_util');
    app = require('./app').app;
  });
  beforeEach(async () => {
    // Reset mocks
    // TODO: Revisit whether this is necessary.
    jest.clearAllMocks();
  });

  it('authenticates Twilio', async () => {
    await request(app)
      .post('/twilio-pull')
      .send({
        From: mockConstituentPhoneNumber,
        To: mockTwilioPhoneNumber,
        Body: mockConstituentMessage,
        SmsMessageSid: mockInboundSmsMessageSid
      })
      .expect(200)
      .expect('Content-Type', "text/xml");

    expect(TwilioUtil.passesAuth).toHaveBeenCalled();
  });

  describe('NEW constituent', () => {
    beforeAll(() => {
      (RedisApiUtil.getHash as jest.Mock).mockResolvedValue(null);
    });

    beforeEach(async () => {
      await request(app)
        .post('/twilio-pull')
        .send({
          From: mockConstituentPhoneNumber,
          To: mockTwilioPhoneNumber,
          Body: mockConstituentMessage,
          SmsMessageSid: mockInboundSmsMessageSid
        })
        .expect(200)
        .expect('Content-Type', "text/xml");
    });

    it('replies', async () => {
      expect(TwilioApiUtil2.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('adds constituent SMS-to-agent lookup to in-memory database', async () => {
      expect(RedisApiUtil.setHash).toHaveBeenCalledTimes(1);
      expect(RedisApiUtil.setHash).toHaveBeenCalledWith(expect.anything(), `${mockConstituentId}:${mockTwilioPhoneNumber}`, expect.objectContaining({
        userId: mockConstituentId,
        twilioPhoneNumber: mockTwilioPhoneNumber,
        userPhoneNumber: mockConstituentPhoneNumber,
        isDemo: false,
        volunteerEngaged: false,
        lastVoterMessageSecsFromEpoch: expect.anything(),
        numStateSelectionAttempts: 0,
      }));
    });

    it('logs constituent message to persistent database', async () => {
      expect(DbApiUtil.logMessageToDb).toHaveBeenCalledWith(expect.objectContaining({
        "archived": false, "automated": null, "confirmedDisclaimer": false, "direction": "INBOUND", "entryPoint": "PULL",
        "fromPhoneNumber": mockConstituentPhoneNumber, "isDemo": false, "lastVoterMessageSecsFromEpoch": expect.any(Number),
        "message": mockConstituentMessage, "originatingSlackUserId": null, "originatingSlackUserName": null,
        "slackChannel": null, "slackError": null, "slackMessageTs": null, "slackParentMessageTs": null,
        "slackReceiveTimestamp": null, "slackRetryNum": null, "slackRetryReason": null, "slackSendTimestamp": null,
        "stateName": undefined, "successfullySent": null, "toPhoneNumber": mockTwilioPhoneNumber, "twilioAttachments": [],
        "twilioError": null, "twilioMessageSid": mockInboundSmsMessageSid, "twilioReceiveTimestamp": expect.anything(),
        "twilioSendTimestamp": null, "unprocessedMessage": null, "userId": mockConstituentId
      }));
    });
  
    it('logs response to persistent database', async () => {
      expect(DbApiUtil.logMessageToDb).toHaveBeenCalledWith(expect.objectContaining({
        "archived": false, "automated": true, "confirmedDisclaimer": false, "direction": "OUTBOUND",
        "entryPoint": "PULL", "fromPhoneNumber": mockTwilioPhoneNumber, "isDemo": false,
        "lastVoterMessageSecsFromEpoch": expect.any(Number), "message": expect.any(String), "originatingSlackUserId": null,
        "originatingSlackUserName": null, "slackChannel": null, "slackError": null, "slackMessageTs": null,
        "slackParentMessageTs": null, "slackReceiveTimestamp": null, "slackRetryNum": null, "slackRetryReason": null,
        "slackSendTimestamp": null, "stateName": undefined, "successfullySent": true, "toPhoneNumber": mockConstituentPhoneNumber,
        "twilioMessageSid": mockOutboundSmsMessageSid, "twilioReceiveTimestamp": null, "twilioSendTimestamp": expect.anything(),
        "unprocessedMessage": null, "userId": mockConstituentId
      }));
    });
  });

  describe('PRE_ENTERING_AUTOMATED constituent', () => {
    beforeAll(() => {
      (RedisApiUtil.getHash as jest.Mock).mockResolvedValue({
        userId: mockConstituentId,
        twilioPhoneNumber: mockTwilioPhoneNumber,
        userPhoneNumber: mockConstituentPhoneNumber,
        isDemo: false,
        volunteerEngaged: false,
        confirmedDisclaimer: false,
        lastVoterMessageSecsFromEpoch: 12345,
        numStateSelectionAttempts: 0,
        sessionStartEpoch: 12345,
        entryPoint: 'PULL',
      });
    });

    beforeEach(async () => {
      await request(app)
        .post('/twilio-pull')
        .send({
          From: mockConstituentPhoneNumber,
          To: mockTwilioPhoneNumber,
          Body: mockConstituentMessage,
          SmsMessageSid: mockInboundSmsMessageSid
        })
        .expect(200)
        .expect('Content-Type', "text/xml");
    });

    it('replies', async () => {
      expect(TwilioApiUtil2.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('updates constituent SMS-to-agent lookup in in-memory database', async () => {
      expect(RedisApiUtil.setHash).toHaveBeenCalledTimes(1);
      expect(RedisApiUtil.setHash).toHaveBeenCalledWith(expect.anything(), `${mockConstituentId}:${mockTwilioPhoneNumber}`, expect.objectContaining({
        userId: mockConstituentId,
        twilioPhoneNumber: mockTwilioPhoneNumber,
        userPhoneNumber: mockConstituentPhoneNumber,
        isDemo: false,
        volunteerEngaged: false,
        lastVoterMessageSecsFromEpoch: expect.anything(),
        numStateSelectionAttempts: 0,
      }));
    });

    it('logs constituent message to persistent database', async () => {
      expect(DbApiUtil.logMessageToDb).toHaveBeenCalledWith(expect.objectContaining({
        "archived": false, "automated": null, "confirmedDisclaimer": false, "direction": "INBOUND", "entryPoint": "PULL",
        "fromPhoneNumber": mockConstituentPhoneNumber, "isDemo": false, "lastVoterMessageSecsFromEpoch": expect.any(Number),
        "message": mockConstituentMessage, "originatingSlackUserId": null, "originatingSlackUserName": null,
        "slackChannel": null, "slackError": null, "slackMessageTs": null, "slackParentMessageTs": null,
        "slackReceiveTimestamp": null, "slackRetryNum": null, "slackRetryReason": null, "slackSendTimestamp": null,
        "stateName": undefined, "successfullySent": null, "toPhoneNumber": mockTwilioPhoneNumber, "twilioAttachments": [],
        "twilioError": null, "twilioMessageSid": mockInboundSmsMessageSid, "twilioReceiveTimestamp": expect.anything(),
        "twilioSendTimestamp": null, "unprocessedMessage": null, "userId": mockConstituentId
      }));
    });
  
    it('logs response to persistent database', async () => {
      expect(DbApiUtil.logMessageToDb).toHaveBeenCalledWith(expect.objectContaining({
        "archived": false, "automated": true, "confirmedDisclaimer": false, "direction": "OUTBOUND",
        "entryPoint": "PULL", "fromPhoneNumber": mockTwilioPhoneNumber, "isDemo": false,
        "lastVoterMessageSecsFromEpoch": expect.any(Number), "message": expect.any(String), "originatingSlackUserId": null,
        "originatingSlackUserName": null, "slackChannel": null, "slackError": null, "slackMessageTs": null,
        "slackParentMessageTs": null, "slackReceiveTimestamp": null, "slackRetryNum": null, "slackRetryReason": null,
        "slackSendTimestamp": null, "stateName": undefined, "successfullySent": true, "toPhoneNumber": mockConstituentPhoneNumber,
        "twilioMessageSid": mockOutboundSmsMessageSid, "twilioReceiveTimestamp": null, "twilioSendTimestamp": expect.anything(),
        "unprocessedMessage": null, "userId": mockConstituentId
      }));
    });
  });

  describe('ENTERING, unknown constituent', () => {
    beforeEach(async () => {
      // Return different message ts for the first (parent) message
      // than the subsequent (nested) messages.
      (SlackApiUtil.sendMessage as jest.Mock).mockResolvedValueOnce({
        data: {
          channel: mockSlackChannelId,
          ts: mockSlackParentThreadTs,
        }
      }).mockResolvedValue({
        data: {
          channel: mockSlackChannelId,
          ts: mockSlackNestedMessageTs,
        }
      });
    });

    beforeAll(() => {
      (RedisApiUtil.getHash as jest.Mock).mockImplementation(async (_, key) => {
        if (key === 'slackPodChannelIds') {
          return Promise.resolve({
            [mockThreadInfoChannelName1]: mockThreadInfoChannelId1,
            [mockThreadInfoChannelName2]: mockThreadInfoChannelId2,
          });
        } else {
          // This defines an unknown constituent.
          return Promise.resolve(null);
        }
      });
      (DbApiUtil.getMessageHistoryFor as jest.Mock).mockResolvedValue(mockHistoricalMessages);
    });

    describe.each([true, false])('For skipLobby=%p', (skipLobby) => {
      beforeEach(() => {
        config.skipLobby = skipLobby;
      })

      it('replies', async () => {
        await sendAndExpectSuccessForHelplineRequest(app);

        expect(TwilioApiUtil2.sendMessage).toHaveBeenCalledTimes(1);
      });

      it('adds constituent SMS-to-agent lookup to in-memory database', async () => {
        await sendAndExpectSuccessForHelplineRequest(app);

        expect(RedisApiUtil.setHash).toHaveBeenCalledWith(expect.anything(), `${mockConstituentId}:${mockTwilioPhoneNumber}`, expect.objectContaining({
          userId: mockConstituentId,
          twilioPhoneNumber: mockTwilioPhoneNumber,
          userPhoneNumber: mockConstituentPhoneNumber,
          isDemo: false,
          volunteerEngaged: false,
          lastVoterMessageSecsFromEpoch: expect.anything(),
          numStateSelectionAttempts: 0,
        }));
      });

      it('only adds constituent agent-to-SMS lookup to in-memory database if using lobby', async () => {
        await sendAndExpectSuccessForHelplineRequest(app);

        if (skipLobby) {
          expect(RedisApiUtil.setHash).not.toHaveBeenCalledWith(expect.anything(), `${mockSlackChannelId}:${mockSlackParentThreadTs}`, expect.anything());
        } else {
          expect(RedisApiUtil.setHash).toHaveBeenCalledWith(expect.anything(), `${mockSlackChannelId}:${mockSlackParentThreadTs}`, expect.objectContaining({
            twilioPhoneNumber: mockTwilioPhoneNumber,
            userPhoneNumber: mockConstituentPhoneNumber,
          }));
        }
      });

      it('logs initial voter status to persistent database', async () => {
        await sendAndExpectSuccessForHelplineRequest(app);

        expect(DbApiUtil.logInitialVoterStatusToDb).toHaveBeenCalledWith(mockConstituentId,
          mockConstituentPhoneNumber,
          mockTwilioPhoneNumber,
          /*is_demo=*/false);
      });

      it('only adds the consituent to the helpline if using lobby', async () => {
        await sendAndExpectSuccessForHelplineRequest(app);

        if (skipLobby) {
          expect(SlackApiUtil.sendMessage).not.toHaveBeenCalled();
        } else {
          expect(SlackApiUtil.sendMessage).toHaveBeenCalledWith(
            mockTopLevelThreadSlackMessage,
            mockTopLevelThreadSlackOptions
          );
        }
      });

      it('only posts constituent message history to helpline if using lobby', async () => {
        await sendAndExpectSuccessForHelplineRequest(app);

        if (skipLobby) {
          expect(SlackApiUtil.sendMessage).not.toHaveBeenCalled();
        } else {
          expect(SlackApiUtil.sendMessage).toHaveBeenCalledWith(
            // TODO: Make this more programmatic, and change it to be more realistic to
            // a voter who is unknown (i.e. such that the only message history is HELPLINE in the current message).
            expect.stringMatching(/Below is the voter's message history so far\.[\s\S]*Voter 8e110[\s\S]*hi can you help me vote\?[\s\S]*Helpline \(Automated\)[\s\S]*hi welcome to the helpline/),
            {
              parentMessageTs: mockSlackParentThreadTs,
              channel: mockSlackChannelId,
            }
          );
        }
      });

      it('logs constituent message to persistent database', async () => {
        await sendAndExpectSuccessForHelplineRequest(app);

        let slackChannel;
        let slackParentMessageTs;
        if (skipLobby) {
          slackChannel = nonExistentLobbySlackChannelId;
          slackParentMessageTs = nonExistentLobbySlackParentThreadTs;
        } else {
          slackChannel = mockSlackChannelId;
          slackParentMessageTs = mockSlackParentThreadTs;
        }
        // TODO: Create a default version of this that can be modified by the test for only relevant parts.
        expect(DbApiUtil.logMessageToDb).toHaveBeenCalledWith(expect.objectContaining({
          "archived": false, "automated": null, "confirmedDisclaimer": false, "direction": "INBOUND", "entryPoint": "PULL",
          "fromPhoneNumber": mockConstituentPhoneNumber, "isDemo": false, "lastVoterMessageSecsFromEpoch": expect.any(Number),
          "message": "HELPLINE", "originatingSlackUserId": null, "originatingSlackUserName": null,
          "slackChannel": slackChannel, "slackError": null, "slackMessageTs": null, "slackParentMessageTs": slackParentMessageTs,
          "slackReceiveTimestamp": null, "slackRetryNum": null, "slackRetryReason": null, "slackSendTimestamp": expect.any(Date),
          "stateName": undefined, "successfullySent": null, "toPhoneNumber": mockTwilioPhoneNumber, "twilioAttachments": [],
          "twilioError": null, "twilioMessageSid": mockInboundSmsMessageSid, "twilioReceiveTimestamp": expect.anything(),
          "twilioSendTimestamp": null, "unprocessedMessage": null, "userId": mockConstituentId
        }));
      });
    
      it('logs response to persistent database', async () => {
        await sendAndExpectSuccessForHelplineRequest(app);

        // TODO: Create a default version of this that can be modified by the test for only relevant parts.
        expect(DbApiUtil.logMessageToDb).toHaveBeenCalledWith(expect.objectContaining({
          "archived": false, "automated": true, "confirmedDisclaimer": false, "direction": "OUTBOUND",
          "entryPoint": "PULL", "fromPhoneNumber": mockTwilioPhoneNumber, "isDemo": false,
          "lastVoterMessageSecsFromEpoch": expect.any(Number), "message": expect.any(String), "originatingSlackUserId": null,
          "originatingSlackUserName": null, "slackChannel": null, "slackError": null, "slackMessageTs": null,
          "slackParentMessageTs": null, "slackReceiveTimestamp": null, "slackRetryNum": null, "slackRetryReason": null,
          "slackSendTimestamp": null, "stateName": undefined, "successfullySent": true, "toPhoneNumber": mockConstituentPhoneNumber,
          "twilioMessageSid": mockOutboundSmsMessageSid, "twilioReceiveTimestamp": null, "twilioSendTimestamp": expect.anything(),
          "unprocessedMessage": null, "userId": mockConstituentId
        }));
      });

      it('logs thread to persistent database', async () => {
        await sendAndExpectSuccessForHelplineRequest(app);

        if (skipLobby) {
          expect(DbApiUtil.logThreadToDb).not.toHaveBeenCalled();
        } else {
          expect(DbApiUtil.logThreadToDb).toHaveBeenCalledWith(expect.objectContaining({
            slackParentMessageTs: mockSlackParentThreadTs,
            channelId: mockSlackChannelId,
            userId: mockConstituentId,
            userPhoneNumber: mockConstituentPhoneNumber,
            twilioPhoneNumber: mockTwilioPhoneNumber,
            needsAttention: true,
            isDemo: false,
            sessionStartEpoch: expect.any(Number),
          }));
        }
      });
    });
  });
});