import request from 'supertest';
import Hashes from 'jshashes';

const mockConstituentPhoneNumber = 'mockConstituentPhoneNumber';
const MD5 = new Hashes.MD5();
const mockConstituentId = MD5.hex(mockConstituentPhoneNumber);
const mockTwilioPhoneNumber = 'mockTwilioPhoneNumber';
const mockConstituentMessage = 'mockConstituentMessage';
const mockInboundSmsMessageSid = 'mockInboundSmsMessageSid';
const mockOutboundSmsMessageSid = 'mockOutboundSmsMessageSid';

jest.mock('./twilio_util', () => ({
  twilioCallbackURL: jest.fn(),
  getAttachments: jest.fn().mockReturnValue([]),
  passesAuth: jest.fn().mockReturnValue(true),
}));

jest.mock('./slack_api_util', () => ({
  sendMessage: jest.fn(),
}));

jest.mock('./twilio_api_util_refactored', () => ({
  sendMessage: jest.fn().mockReturnValue({
    success: true,
    sid: mockOutboundSmsMessageSid,
  }),
}));

jest.mock('./redis_api_util', () => ({
  setHash: jest.fn(),
  getHash: jest.fn(),
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
}));

import * as TwilioUtil from './twilio_util';
import * as RedisApiUtil from './redis_api_util';
import * as DbApiUtil from './db_api_util';



describe('POST /twilio-pull', () => {
  let TwilioApiUtil2: { sendMessage: any; };
  let app: any;
  beforeAll(() => {
    TwilioApiUtil2 = require('./twilio_api_util_refactored');
    app = require('./app').app;
  });
  beforeEach(() => {

    // Reset mocks
    // TODO: Revisit whether this is necessary.
    jest.clearAllMocks();
  });

  it('should authenticate Twilio', async () => {
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
      jest.mock('./redis_api_util', () => ({
        // This defines a new constituent.
        getHash: jest.fn().mockReturnValue(null),
      }));
      app = require('./app').app;
    });

    it('should reply', async () => {
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

      expect(TwilioApiUtil2.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('should add constituent to in-memory database', async () => {
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

    it('should log constituent message to persistent database', async () => {
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
  
  
      expect(DbApiUtil.logMessageToDb).toHaveBeenCalledWith(expect.objectContaining({
        "archived": false, "automated": null, "confirmedDisclaimer": false, "direction": "INBOUND", "entryPoint": "PULL",
        "fromPhoneNumber": "mockConstituentPhoneNumber", "isDemo": false, "lastVoterMessageSecsFromEpoch": expect.any(Number),
        "message": "mockConstituentMessage", "originatingSlackUserId": null, "originatingSlackUserName": null,
        "slackChannel": null, "slackError": null, "slackMessageTs": null, "slackParentMessageTs": null,
        "slackReceiveTimestamp": null, "slackRetryNum": null, "slackRetryReason": null, "slackSendTimestamp": null,
        "stateName": undefined, "successfullySent": null, "toPhoneNumber": "mockTwilioPhoneNumber", "twilioAttachments": [],
        "twilioError": null, "twilioMessageSid": mockInboundSmsMessageSid, "twilioReceiveTimestamp": expect.anything(),
        "twilioSendTimestamp": null, "unprocessedMessage": null, "userId": "8e11012e2804a933a23197043b99a2b3"
      }));
    });
  
    it('should log response to persistent database', async () => {
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
});