import request from 'supertest';
import Hashes from 'jshashes';

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
    sid: 'mockSid',
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

// import * as TwilioApiUtil2 from './twilio_api_util_refactored';
import * as TwilioUtil from './twilio_util';
import * as RedisApiUtil from './redis_api_util';

const mockConstituentPhoneNumber = 'mockConstituentPhoneNumber';
const MD5 = new Hashes.MD5();
const mockConstituentId = MD5.hex(mockConstituentPhoneNumber);
const mockTwilioPhoneNumber = 'mockTwilioPhoneNumber';
const mockConstituentMessage = 'mockConstituentMessage';
const mockSmsMessageSid = 'mockSmsMessageSid';

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
    const response = await request(app)
      .post('/twilio-pull')
      .send({
        From: mockConstituentPhoneNumber,
        To: mockTwilioPhoneNumber,
        Body: mockConstituentMessage,
        SmsMessageSid: mockSmsMessageSid
      })
    .expect(200)
    .expect('Content-Type', "text/xml");

    expect(TwilioUtil.passesAuth).toHaveBeenCalled();
  });

  describe('NEW constituent', () => {
    beforeAll(() => {
      jest.mock('./redis_api_util', () => ({
        getHash: jest.fn().mockReturnValue(null),
      }));
      app = require('./app').app;
    });

    it('should reply', async () => {
      const response = await request(app)
        .post('/twilio-pull')
        .send({
          From: mockConstituentPhoneNumber,
          To: mockTwilioPhoneNumber,
          Body: mockConstituentMessage,
          SmsMessageSid: mockSmsMessageSid
        })
      .expect(200)
      .expect('Content-Type', "text/xml");

      expect(TwilioApiUtil2.sendMessage).toHaveBeenCalled();
    });

    it('should add constituent to Redis', async () => {
      const response = await request(app)
        .post('/twilio-pull')
        .send({
          From: mockConstituentPhoneNumber,
          To: mockTwilioPhoneNumber,
          Body: mockConstituentMessage,
          SmsMessageSid: mockSmsMessageSid
        })
      .expect(200)
      .expect('Content-Type', "text/xml");
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
  });
});