let Router;
let StateParser;
let TwilioApiUtil;
let SlackApiUtil;
let SlackInteractionApiUtil;
let SlackBlockUtil;
let RedisApiUtil;
let DbApiUtil;
let LoadBalancer;
let Hashes;
let redis;
let redisClient;
let call;

const requireModules = () => {
  Router = require('./router');
  StateParser = require('./state_parser');
  TwilioApiUtil = require('./twilio_api_util');
  SlackApiUtil = require('./slack_api_util');
  SlackInteractionApiUtil = require('./slack_interaction_api_util');
  SlackBlockUtil = require('./slack_block_util');
  RedisApiUtil = require('./redis_api_util');
  DbApiUtil = require('./db_api_util');
  LoadBalancer = require('./load_balancer');
  Hashes = require('jshashes'); // v1.0.5
  redis = require('redis-mock');
  redisClient = redis.createClient();

  jest.mock('./twilio_api_util');
  jest.mock('./state_parser');

  SlackApiUtil.sendMessage = jest.fn();
  SlackApiUtil.fetchSlackMessageBlocks = jest.fn();
  SlackInteractionApiUtil.replaceSlackMessageBlocks = jest.fn();
  RedisApiUtil.setHash = jest.fn();
  DbApiUtil.getMessageHistoryFor = jest.fn();
  DbApiUtil.logVoterStatusToDb = jest.fn();
  DbApiUtil.logThreadToDb = jest.fn();
  DbApiUtil.setThreadNeedsAttentionToDb = jest.fn();
  DbApiUtil.getThreadNeedsAttentionFor = jest.fn();
  DbApiUtil.setThreadHistoryTs = jest.fn();
  DbApiUtil.updateThreadStatusFromMessage = jest.fn();

  SlackBlockUtil.populateDropdownWithLatestVoterStatus = jest.fn();
};

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
});

// expectNthSlackMessageToChannel tests the Nth (0-indexed) slack message sent to the given
// channel to make sure the message contains the given message string segments
// and (optionally) was sent to the given thread (parentMessageTs).
const expectNthSlackMessageToChannel = (
  channel,
  n,
  messageParts,
  parentMessageTs,
  skipAssertions
) => {
  const numAssertions = parentMessageTs
    ? messageParts.length + 1
    : messageParts.length;
  if (!skipAssertions) {
    expect.assertions(numAssertions);
  }
  let channelMessageNum = -1;
  for (let i = 0; i < SlackApiUtil.sendMessage.mock.calls.length; i++) {
    const slackMessageParams = SlackApiUtil.sendMessage.mock.calls[i][1];
    console.log(slackMessageParams, channel);
    if (slackMessageParams.channel == channel) {
      channelMessageNum++;
      if (channelMessageNum == n) {
        const slackMessage = SlackApiUtil.sendMessage.mock.calls[i][0];
        for (let j = 0; j < messageParts.length; j++) {
          expect(slackMessage).toEqual(
            expect.stringContaining(messageParts[j])
          );
        }
        if (parentMessageTs) {
          expect(slackMessageParams).toEqual(
            expect.objectContaining({
              parentMessageTs,
            })
          );
        }
        break;
      }
    }
  }
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
});

const handleNewVoterWrapper = (
  userOptions,
  redisClient,
  twilioPhoneNumber,
  inboundDbMessageEntry
) => {
  return new Promise((resolve) => {
    resolve(
      Router.handleNewVoter(
        userOptions,
        redisClient,
        twilioPhoneNumber,
        inboundDbMessageEntry,
        LoadBalancer.PULL_ENTRY_POINT
      )
    );
  });
};

describe('handleNewVoter', () => {
  beforeEach(() => {
    requireModules();
    SlackApiUtil.sendMessage.mockResolvedValue({
      data: {
        ts: '293874928374',
        channel: 'CTHELOBBYID',
      },
    });

    const inboundDbMessageEntry = {
      mock: 'inboundDbMessageEntryData',
    };

    const userPhoneNumber = '+1234567890';
    const MD5 = new Hashes.MD5();
    const userId = MD5.hex(userPhoneNumber);

    return handleNewVoterWrapper(
      {
        userPhoneNumber,
        userMessage: 'can you help me vote',
        userId,
      },
      redisClient,
      '+12054985052',
      inboundDbMessageEntry
    );
  });

  test('Announces new voter message in Slack', () => {
    expect(SlackApiUtil.sendMessage.mock.calls[0][0]).toContain('New voter');
  });

  test('Announces new voter message to Slack #lobby channel if non-demo line', () => {
    expect(SlackApiUtil.sendMessage.mock.calls[0][1].channel).toBe('lobby');
  });

  test('Announces new voter message to Slack #demo-lobby channel if demo line', () => {
    jest.clearAllMocks();
    const inboundDbMessageEntry = {};

    const userPhoneNumber = '+1234567890';
    const MD5 = new Hashes.MD5();
    const userId = MD5.hex(userPhoneNumber);

    return handleNewVoterWrapper(
      {
        userPhoneNumber,
        userMessage: 'can you help me vote',
        userId,
      },
      redisClient,
      '+18555553440',
      inboundDbMessageEntry
    ).then(() => {
      expect(SlackApiUtil.sendMessage.mock.calls[0][1].channel).toBe(
        'demo-lobby'
      );
    });
  });

  test('Relays voter message in subsequent message to Slack', () => {
    expect(SlackApiUtil.sendMessage.mock.calls[1][0]).toEqual(
      expect.stringContaining('can you help me vote')
    );
    expect(SlackApiUtil.sendMessage.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        parentMessageTs: '293874928374',
        channel: 'CTHELOBBYID',
      })
    );
  });

  test('Passes inbound database entry object to SlackApiUtil for logging', () => {
    expect(SlackApiUtil.sendMessage.mock.calls[1][2]).toEqual(
      expect.objectContaining({
        mock: 'inboundDbMessageEntryData',
      })
    );
    // Ensure userInfo is passed to SlackApiUtil
    expect(SlackApiUtil.sendMessage.mock.calls[1][3]).not.toBeUndefined();
  });

  test('Includes updated lastVoterMessageSecsFromEpoch in inbound database entry object for logging', () => {
    const secsFromEpochNow = Math.round(Date.now() / 1000);
    const userInfo = SlackApiUtil.sendMessage.mock.calls[1][3];
    const newLastVoterMessageSecsFromEpoch =
      userInfo.lastVoterMessageSecsFromEpoch;
    expect(newLastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(
      10
    );
  });

  test('Relays automated welcoming of voter to Slack', () => {
    expect(SlackApiUtil.sendMessage.mock.calls[2][0]).toEqual(
      expect.stringContaining('Welcome')
    );
  });

  test('Sends one response to the user', () => {
    expect(TwilioApiUtil.sendMessage).toHaveBeenCalledTimes(1);
  });

  test('Sends one response to the user with welcome and disclaimer', () => {
    expect(TwilioApiUtil.sendMessage.mock.calls[0][0]).toEqual(
      expect.stringMatching(/welcome/i)
    );
    expect(TwilioApiUtil.sendMessage.mock.calls[0][0]).toEqual(
      expect.stringMatching(/you release Voter Help Line of all liability/i)
    );
    expect(TwilioApiUtil.sendMessage.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        twilioPhoneNumber: '+12054985052',
        userPhoneNumber: '+1234567890',
      })
    );
  });

  test('Creates outbound database entry and passes to TwilioApiUtil for logging', () => {
    expect(TwilioApiUtil.sendMessage.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        direction: 'OUTBOUND',
        automated: true,
      })
    );
  });

  test('Includes updated lastVoterMessageSecsFromEpoch in outbound database entry object for logging', () => {
    const secsFromEpochNow = Math.round(Date.now() / 1000);
    const dbMessageEntry = TwilioApiUtil.sendMessage.mock.calls[0][2];
    const newLastVoterMessageSecsFromEpoch =
      dbMessageEntry.lastVoterMessageSecsFromEpoch;
    expect(newLastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(
      10
    );
  });

  test('Adds two hashes to redisClient', () => {
    expect(RedisApiUtil.setHash).toHaveBeenCalledTimes(2);
  });

  test('Adds redisClient Twilio-to-Slack lookup with userId:TwilioPhoneNumber key', () => {
    const MD5 = new Hashes.MD5();
    const userId = MD5.hex('+1234567890');
    expect(RedisApiUtil.setHash.mock.calls).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([`${userId}:+12054985052`]),
      ])
    );
  });

  test('Adds redisClient Twilio-to-Slack lookup with active Slack channel', () => {
    expect.assertions(1);
    const MD5 = new Hashes.MD5();
    const userId = MD5.hex('+1234567890');
    for (call of RedisApiUtil.setHash.mock.calls) {
      const key = call[1];
      if (key == `${userId}:+12054985052`) {
        const value = call[2];
        expect(value.activeChannelId).toEqual('CTHELOBBYID');
      }
    }
  });

  test('Adds redisClient Twilio-to-Slack lookup with Slack lobby channel id to thread lookup', () => {
    expect.assertions(1);
    const MD5 = new Hashes.MD5();
    const userId = MD5.hex('+1234567890');
    for (call of RedisApiUtil.setHash.mock.calls) {
      const key = call[1];
      if (key == `${userId}:+12054985052`) {
        const value = call[2];
        expect(value['CTHELOBBYID']).toEqual('293874928374');
      }
    }
  });

  test('Adds redisClient Twilio-to-Slack lookup with isDemo:true for demo line', () => {
    expect.assertions(1);
    const userPhoneNumber = '+1234567890';
    const MD5 = new Hashes.MD5();
    const userId = MD5.hex(userPhoneNumber);

    jest.clearAllMocks();
    const inboundDbMessageEntry = {};
    return handleNewVoterWrapper(
      {
        userPhoneNumber,
        userMessage: 'can you help me vote',
        userId,
      },
      redisClient,
      '+18555553440',
      inboundDbMessageEntry
    ).then(() => {
      for (call of RedisApiUtil.setHash.mock.calls) {
        const key = call[1];
        if (key == `${userId}:+18555553440`) {
          const value = call[2];
          expect(value).toEqual(expect.objectContaining({ isDemo: true }));
        }
      }
    });
  });

  test('Adds redisClient Twilio-to-Slack lookup with isDemo:false for non-demo line', () => {
    expect.assertions(1);
    const MD5 = new Hashes.MD5();
    const userId = MD5.hex('+1234567890');
    for (call of RedisApiUtil.setHash.mock.calls) {
      const key = call[1];
      if (key == `${userId}:+12054985052`) {
        const value = call[2];
        expect(value).toEqual(expect.objectContaining({ isDemo: false }));
      }
    }
  });

  test('Adds redisClient Twilio-to-Slack lookup with confirmedDisclaimer:false', () => {
    expect.assertions(1);
    const MD5 = new Hashes.MD5();
    const userId = MD5.hex('+1234567890');
    for (call of RedisApiUtil.setHash.mock.calls) {
      const key = call[1];
      if (key == `${userId}:+12054985052`) {
        const value = call[2];
        expect(value).toEqual(
          expect.objectContaining({ confirmedDisclaimer: false })
        );
      }
    }
  });

  test('Adds redisClient Twilio-to-Slack lookup with lastVoterMessageSecsFromEpoch', () => {
    expect.assertions(1);
    const MD5 = new Hashes.MD5();
    const userId = MD5.hex('+1234567890');
    const secsFromEpochNow = Math.round(Date.now() / 1000);
    for (call of RedisApiUtil.setHash.mock.calls) {
      const key = call[1];
      if (key == `${userId}:+12054985052`) {
        const value = call[2];
        const lastVoterMessageSecsFromEpoch =
          value.lastVoterMessageSecsFromEpoch;
        expect(lastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(
          10
        );
      }
    }
  });

  test('Adds redisClient Twilio-to-Slack lookup with userPhoneNumber', () => {
    expect.assertions(1);
    const MD5 = new Hashes.MD5();
    const userId = MD5.hex('+1234567890');
    for (call of RedisApiUtil.setHash.mock.calls) {
      const key = call[1];
      if (key == `${userId}:+12054985052`) {
        const value = call[2];
        expect(value).toEqual(
          expect.objectContaining({ userPhoneNumber: '+1234567890' })
        );
      }
    }
  });

  test('Adds redisClient Slack-to-Twilio lookup', () => {
    expect(RedisApiUtil.setHash.mock.calls).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['CTHELOBBYID:293874928374']),
      ])
    );
  });

  test('Adds redisClient Slack-to-Twilio lookup with user phone number', () => {
    expect.assertions(1);
    for (call of RedisApiUtil.setHash.mock.calls) {
      const key = call[1];
      if (key == 'CTHELOBBYID:293874928374') {
        const value = call[2];
        expect(value).toEqual(
          expect.objectContaining({ userPhoneNumber: '+1234567890' })
        );
      }
    }
  });

  test('Adds redisClient Slack-to-Twilio lookup with Twilio phone number', () => {
    for (call of RedisApiUtil.setHash.mock.calls) {
      const key = call[1];
      if (key == 'CTHELOBBYID:293874928374') {
        const value = call[2];
        expect(value).toEqual(
          expect.objectContaining({ twilioPhoneNumber: '+12054985052' })
        );
      }
    }
  });
});

const determineVoterStateWrapper = (
  userOptions,
  redisClient,
  twilioPhoneNumber,
  inboundDbMessageEntry
) => {
  return new Promise((resolve) => {
    resolve(
      Router.determineVoterState(
        userOptions,
        redisClient,
        twilioPhoneNumber,
        inboundDbMessageEntry
      )
    );
  });
};

describe('determineVoterState', () => {
  beforeEach(() => {
    requireModules();
  });

  describe('Runs regardless of whether U.S. state identified successfully', () => {
    beforeEach(() => {
      SlackApiUtil.sendMessage.mockResolvedValue({
        data: {
          ts: '293874928374',
          channel: 'CTHELOBBYID',
        },
      });

      const inboundDbMessageEntry = {
        mock: 'inboundDbMessageEntryData',
      };

      return determineVoterStateWrapper(
        {
          userPhoneNumber: '+1234567890',
          userMessage: 'nonsensical statement',
          userInfo: {
            activeChannelId: 'CTHELOBBYID',
            CTHELOBBYID: '293874928374',
            confirmedDisclaimer: false,
            isDemo: false,
            userId: '0923e1f4fb612739d9c5918c57656d5f',
          },
        },
        redisClient,
        '+12054985052',
        inboundDbMessageEntry
      );
    });
    test('Passes voter message to Slack', () => {
      expect(SlackApiUtil.sendMessage.mock.calls[0][0]).toContain(
        'nonsensical statement'
      );
    });

    test("Sends voter message to voter's channel/thread in Slack lobby", () => {
      expect(SlackApiUtil.sendMessage.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          parentMessageTs: '293874928374',
          channel: 'CTHELOBBYID',
        })
      );
    });

    test('Passes inbound database entry object to SlackApiUtil for logging', () => {
      expect(SlackApiUtil.sendMessage.mock.calls[0][2]).toEqual(
        expect.objectContaining({
          mock: 'inboundDbMessageEntryData',
        })
      );
      // Ensure userInfo is passed to SlackApiUtil
      expect(SlackApiUtil.sendMessage.mock.calls[0][3]).not.toBeUndefined();
    });

    test('Includes updated lastVoterMessageSecsFromEpoch in inbound database entry object for logging', () => {
      const secsFromEpochNow = Math.round(Date.now() / 1000);
      const userInfo = SlackApiUtil.sendMessage.mock.calls[0][3];
      const newLastVoterMessageSecsFromEpoch =
        userInfo.lastVoterMessageSecsFromEpoch;
      expect(newLastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(
        10
      );
    });
  });

  describe("Couldn't determine voter U.S. state", () => {
    beforeEach(() => {
      StateParser.determineState.mockReturnValue(null);
      SlackApiUtil.sendMessage.mockResolvedValue({
        data: {
          ts: '293874928374',
          channel: 'CTHELOBBYID',
        },
      });

      const inboundDbMessageEntry = {
        mock: 'inboundDbMessageEntryData',
      };

      return determineVoterStateWrapper(
        {
          userPhoneNumber: '+1234567890',
          userMessage: 'nonsensical statement',
          userInfo: {
            activeChannelId: 'CTHELOBBYID',
            CTHELOBBYID: '293874928374',
            confirmedDisclaimer: false,
            isDemo: false,
            userId: '0923e1f4fb612739d9c5918c57656d5f',
          },
        },
        redisClient,
        '+12054985052',
        inboundDbMessageEntry
      );
    });

    test("Sends a message to voter clarifying if U.S. state wasn't recognized", () => {
      expect(TwilioApiUtil.sendMessage.mock.calls[0][0]).toContain(
        "didn't understand"
      );
      expect(TwilioApiUtil.sendMessage.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          userPhoneNumber: '+1234567890',
          twilioPhoneNumber: '+12054985052',
        })
      );
    });

    test('Creates outbound database entry and passes to TwilioApiUtil for logging', () => {
      expect(TwilioApiUtil.sendMessage.mock.calls[0][2]).toEqual(
        expect.objectContaining({
          direction: 'OUTBOUND',
          automated: true,
        })
      );
    });

    test('Includes updated lastVoterMessageSecsFromEpoch in outbound database entry object for logging', () => {
      const secsFromEpochNow = Math.round(Date.now() / 1000);
      const dbMessageEntry = TwilioApiUtil.sendMessage.mock.calls[0][2];
      const newLastVoterMessageSecsFromEpoch =
        dbMessageEntry.lastVoterMessageSecsFromEpoch;
      expect(newLastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(
        10
      );
    });

    test('Sends copy of message clarifying U.S. state to Slack', () => {
      expect(SlackApiUtil.sendMessage.mock.calls[1][0]).toContain(
        "didn't understand"
      );
      expect(SlackApiUtil.sendMessage.mock.calls[1][1]).toEqual(
        expect.objectContaining({
          parentMessageTs: '293874928374',
          channel: 'CTHELOBBYID',
        })
      );
    });

    test('Updates redisClient Twilio-to-Slack lookup with lastVoterMessageSecsFromEpoch', () => {
      const secsFromEpochNow = Math.round(Date.now() / 1000);
      for (call of RedisApiUtil.setHash.mock.calls) {
        const key = call[1];
        if (key == '+1234567890:+12054985052') {
          const value = call[2];
          const lastVoterMessageSecsFromEpoch =
            value.lastVoterMessageSecsFromEpoch;
          expect(lastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(
            10
          );
        }
      }
    });
  });

  describe('Successfully determined voter U.S. state', () => {
    // Only declared and not defined here, so that beforeEach can re-initiate
    // these variables anew for each test.
    let lobbySlackMessageResponse;
    let stateSlackMessageResponse;
    let inboundDbMessageEntry;
    let userInfo;
    let twilioPhoneNumber;

    beforeEach(() => {
      lobbySlackMessageResponse = {
        data: {
          ts: '293874928374',
          channel: 'CTHELOBBYID',
        },
      };

      stateSlackMessageResponse = {
        data: {
          ts: '823487983742',
          // In the wild this is actually a channel ID (e.g. C12345678)
          channel: 'CNORTHCAROLINACHANNELID',
        },
      };

      StateParser.determineState.mockReturnValue('North Carolina');

      // This default response will kick in once the mockResolvedValueOnce calls run out.
      SlackApiUtil.sendMessage.mockResolvedValue(stateSlackMessageResponse);

      // This is a bit hacky. Because the calls are async, the messages send
      // simultaneously to lobby and state channels. Second message sent happens
      // to be to state channel (which sort of makes sense when you think about it).
      SlackApiUtil.sendMessage
        .mockResolvedValueOnce(lobbySlackMessageResponse)
        .mockResolvedValueOnce(stateSlackMessageResponse);

      // This is necessary so that the nested operations within this function to complete.
      // An empty array is only okay because this is being left untested.
      SlackApiUtil.fetchSlackMessageBlocks.mockResolvedValue([]);
      // This is necessary so that the nested operations within this function to complete, even though the resolved value isn't used.
      SlackInteractionApiUtil.replaceSlackMessageBlocks.mockResolvedValue(null);
      SlackBlockUtil.populateDropdownWithLatestVoterStatus.mockResolvedValue(
        null
      );

      DbApiUtil.getMessageHistoryFor.mockResolvedValue([
        {
          timestamp: '2020-09-06T13:47:50.500Z',
          message: 'Hi can you help me vote?',
          automated: null,
          direction: 'INBOUND',
          originating_slack_user_id: null,
        },
        {
          timestamp: '2020-09-06T13:47:50.511Z',
          message:
            'Welcome to Voter Help Line! We are excited to help you vote.',
          automated: true,
          direction: 'OUTBOUND',
          originating_slack_user_id: null,
        },
      ]);

      // Mock these functions, as they are called by load balancer.
      redisClient.setAsync = jest.fn();
      redisClient.getAsync = jest.fn();
      redisClient.lrangeAsync = jest.fn();
      // Load balancer requires a return value from these functions
      // so we mock them...
      // ...voter counter.
      redisClient.getAsync.mockResolvedValue('0');
      // ...open voter channels.
      redisClient.lrangeAsync.mockResolvedValue([
        'north-carolina-0',
        'north-carolina-1',
      ]);

      // Mock Redis providing the slackChannelId->slackChannelName lookup.
      redisClient.hgetallAsync = jest.fn();
      redisClient.hgetallAsync.mockResolvedValue([
        'CNORTHCAROLINACHANNELID',
        'demo-north-carolina-0',
      ]);

      inboundDbMessageEntry = {
        mock: 'inboundDbMessageEntryData',
      };

      userInfo = {
        activeChannelId: 'CTHELOBBYID',
        CTHELOBBYID: '293874928374',
        confirmedDisclaimer: false,
        isDemo: false,
        userId: '0923e1f4fb612739d9c5918c57656d5f',
        userPhoneNumber: '+1234567890',
      };

      twilioPhoneNumber = '+12054985052';

      // Leave the calling of determineVoterStateWrapper to each test so that
      // the above variables and mocks can be modified if needed (e.g. for
      // the round robin).
    });

    test('Texts voter confirming U.S. state and informing of retrieving volunteer', () => {
      return determineVoterStateWrapper(
        {
          userPhoneNumber: '+1234567890',
          userMessage: 'NC',
          userInfo,
        },
        redisClient,
        twilioPhoneNumber,
        inboundDbMessageEntry
      ).then(() => {
        expect(TwilioApiUtil.sendMessage.mock.calls[0][0]).toEqual(
          expect.stringMatching(
            /Great!.*We try to reply within minutes but may take 24 hours./i
          )
        );
        expect(TwilioApiUtil.sendMessage.mock.calls[0][1]).toEqual(
          expect.objectContaining({
            userPhoneNumber: '+1234567890',
            twilioPhoneNumber: '+12054985052',
          })
        );
      });
    });

    test('Creates outbound database entry and passes to TwilioApiUtil for logging', () => {
      return determineVoterStateWrapper(
        {
          userPhoneNumber: '+1234567890',
          userMessage: 'NC',
          userInfo,
        },
        redisClient,
        twilioPhoneNumber,
        inboundDbMessageEntry
      ).then(() => {
        expect(TwilioApiUtil.sendMessage.mock.calls[0][2]).toEqual(
          expect.objectContaining({
            direction: 'OUTBOUND',
            automated: true,
          })
        );
      });
    });

    test('Includes updated lastVoterMessageSecsFromEpoch in outbound database entry object for logging', () => {
      return determineVoterStateWrapper(
        {
          userPhoneNumber: '+1234567890',
          userMessage: 'NC',
          userInfo,
        },
        redisClient,
        twilioPhoneNumber,
        inboundDbMessageEntry
      ).then(() => {
        const secsFromEpochNow = Math.round(Date.now() / 1000);
        const dbMessageEntry = TwilioApiUtil.sendMessage.mock.calls[0][2];
        const newLastVoterMessageSecsFromEpoch =
          dbMessageEntry.lastVoterMessageSecsFromEpoch;
        expect(
          newLastVoterMessageSecsFromEpoch - secsFromEpochNow
        ).toBeLessThan(10);
      });
    });

    test('Relays voter text to Slack lobby', () => {
      return determineVoterStateWrapper(
        {
          userPhoneNumber: '+1234567890',
          userMessage: 'NC',
          userInfo,
        },
        redisClient,
        twilioPhoneNumber,
        inboundDbMessageEntry
      ).then(() => {
        expectNthSlackMessageToChannel(
          'CTHELOBBYID',
          0,
          ['NC'],
          '293874928374'
        );
      });
    });

    test('Sends copy of U.S. state confirmation message to Slack lobby', () => {
      return determineVoterStateWrapper(
        {
          userPhoneNumber: '+1234567890',
          userMessage: 'NC',
          userInfo,
        },
        redisClient,
        twilioPhoneNumber,
        inboundDbMessageEntry
      ).then(() => {
        expectNthSlackMessageToChannel(
          'CTHELOBBYID',
          1,
          ['We try to reply within minutes but may take 24 hours.'],
          '293874928374'
        );
      });
    });

    test('Sends operator message to lobby announcing voter is being routed', () => {
      return determineVoterStateWrapper(
        {
          userPhoneNumber: '+1234567890',
          userMessage: 'NC',
          userInfo,
        },
        redisClient,
        twilioPhoneNumber,
        inboundDbMessageEntry
      ).then(() => {
        expectNthSlackMessageToChannel(
          'CTHELOBBYID',
          2,
          ['Routing voter'],
          '293874928374'
        );
      });
    });

    test('Sends first Slack message to U.S. state channel announcing voter with truncated user id', () => {
      return determineVoterStateWrapper(
        {
          userPhoneNumber: '+1234567890',
          userMessage: 'NC',
          userInfo,
        },
        redisClient,
        twilioPhoneNumber,
        inboundDbMessageEntry
      ).then(() => {
        const MD5 = new Hashes.MD5();
        const userId = MD5.hex('+1234567890').substring(0, 5);
        expectNthSlackMessageToChannel('north-carolina-0', 0, [
          'New North Carolina voter',
          userId,
        ]);
      });
    });

    test('Sends first voter to Slack channel for first pod in U.S. state', () => {
      redisClient.lrangeAsync.mockResolvedValue([
        'north-carolina-3',
        'north-carolina-5',
      ]);
      return determineVoterStateWrapper(
        {
          userPhoneNumber: '+1234567890',
          userMessage: 'NC',
          userInfo,
        },
        redisClient,
        twilioPhoneNumber,
        inboundDbMessageEntry
      ).then(() => {
        expectNthSlackMessageToChannel('north-carolina-3', 0, [
          'New North Carolina voter',
        ]);
      });
    });

    test('Sends second voter to Slack channel for second open pod, if more than one pods exists.', () => {
      redisClient.getAsync = jest.fn();
      redisClient.getAsync.mockResolvedValue('1' /* num (previous) voters*/);
      redisClient.lrangeAsync.mockResolvedValue([
        'north-carolina-3',
        'north-carolina-5',
      ]);
      return determineVoterStateWrapper(
        {
          userPhoneNumber: '+1234567890',
          userMessage: 'NC',
          userInfo,
        },
        redisClient,
        twilioPhoneNumber,
        inboundDbMessageEntry
      ).then(() => {
        expectNthSlackMessageToChannel('north-carolina-5', 0, [
          'New North Carolina voter',
        ]);
      });
    });

    test('Sends third voter to Slack channel for first pod in U.S. state, if only two pods exist in entry point', () => {
      redisClient.getAsync = jest.fn();
      redisClient.getAsync.mockResolvedValue('2' /* num (previous) voters*/);
      redisClient.lrangeAsync.mockResolvedValue([
        'north-carolina-3',
        'north-carolina-5',
      ]);
      return determineVoterStateWrapper(
        {
          userPhoneNumber: '+1234567890',
          userMessage: 'NC',
          userInfo,
        },
        redisClient,
        twilioPhoneNumber,
        inboundDbMessageEntry
      ).then(() => {
        expectNthSlackMessageToChannel('north-carolina-3', 0, [
          'New North Carolina voter',
        ]);
      });
    });

    test('Sends third voter to Slack channel for first pod in U.S. state, if only two pods exist in entry point', () => {
      redisClient.getAsync = jest.fn();
      redisClient.getAsync.mockResolvedValue('2' /* num (previous) voters*/);
      redisClient.lrangeAsync.mockResolvedValue([
        'north-carolina-10',
        'north-carolina-15',
      ]);
      return determineVoterStateWrapper(
        {
          userPhoneNumber: '+1234567890',
          userMessage: 'NC',
          userInfo,
        },
        redisClient,
        twilioPhoneNumber,
        inboundDbMessageEntry
      ).then(() => {
        expectNthSlackMessageToChannel('north-carolina-10', 0, [
          'New North Carolina voter',
        ]);
      });
    });

    test('Sends demo voters to Slack demo channel independent of normal channel number of voters and open pods', () => {
      redisClient.getAsync = jest.fn().mockImplementation((voterCounterKey) => {
        let result;
        switch (voterCounterKey) {
          case 'voterCounterPullNorthCarolina':
            result = '0';
            break;
          case 'voterCounterPullDemoNorthCarolina':
            result = '52';
            break;
          default:
            result = null;
        }
        return new Promise((resolve) => resolve(result));
      });

      redisClient.lrangeAsync = jest.fn().mockImplementation((openPodsKey) => {
        let result;
        switch (openPodsKey) {
          case 'openPodsPullNorthCarolina':
            result = ['north-carolina-0'];
            break;
          case 'openPodsPullDemoNorthCarolina':
            result = [
              'demo-north-carolina-0',
              'demo-north-carolina-1',
              'demo-north-carolina-2',
              'demo-north-carolina-3',
              'demo-north-carolina-4',
            ];
            break;
          default:
            result = [];
        }
        return new Promise((resolve) => resolve(result));
      });

      userInfo.isDemo = true;

      return determineVoterStateWrapper(
        {
          userPhoneNumber: '+1234567890',
          userMessage: 'NC',
          userInfo,
        },
        redisClient,
        twilioPhoneNumber,
        inboundDbMessageEntry
      ).then(() => {
        // 53rd demo NC voter goes to #demo-north-carolina-2
        expectNthSlackMessageToChannel('demo-north-carolina-2', 0, [
          'New North Carolina voter',
        ]);
      });
    });

    test('Sends old message history to Slack U.S. state channel thread', () => {
      return determineVoterStateWrapper(
        {
          userPhoneNumber: '+1234567890',
          userMessage: 'NC',
          userInfo,
        },
        redisClient,
        twilioPhoneNumber,
        inboundDbMessageEntry
      ).then(() => {
        // # of assertions = # of message parts + # of calls with parentMessageTs
        expect.assertions(1);
        // Note: First NC message is sent to the pretty channel name.
        expectNthSlackMessageToChannel(
          'CNORTHCAROLINACHANNELID',
          0,
          ['Welcome to Voter Help Line'],
          null,
          true
        );
      });
    });

    test('Updates redisClient Twilio-to-Slack lookup', () => {
      return determineVoterStateWrapper(
        {
          userPhoneNumber: '+1234567890',
          userMessage: 'NC',
          userInfo,
        },
        redisClient,
        twilioPhoneNumber,
        inboundDbMessageEntry
      ).then(() => {
        expect.assertions(2);
        const secsFromEpochNow = Math.round(Date.now() / 1000);
        const MD5 = new Hashes.MD5();
        const userId = MD5.hex('+1234567890');
        for (call of RedisApiUtil.setHash.mock.calls) {
          const key = call[1];
          if (key == `${userId}:+12054985052`) {
            const value = call[2];
            expect(value).toEqual(
              expect.objectContaining({
                // Preserved:
                CTHELOBBYID: '293874928374',
                confirmedDisclaimer: false,
                isDemo: false,
                // Added:
                activeChannelId: 'CNORTHCAROLINACHANNELID',
                CNORTHCAROLINACHANNELID: '823487983742',
                stateName: 'North Carolina',
              })
            );
            const lastVoterMessageSecsFromEpoch =
              value.lastVoterMessageSecsFromEpoch;
            expect(
              lastVoterMessageSecsFromEpoch - secsFromEpochNow
            ).toBeLessThan(10);
          }
        }
      });
    });

    test('Adds redisClient Slack-to-Twilio lookup for the Slack U.S. state channel and thread', () => {
      return determineVoterStateWrapper(
        {
          userPhoneNumber: '+1234567890',
          userMessage: 'NC',
          userInfo,
        },
        redisClient,
        twilioPhoneNumber,
        inboundDbMessageEntry
      ).then(() => {
        expect.assertions(1);
        for (call of RedisApiUtil.setHash.mock.calls) {
          const key = call[1];
          if (key == 'CNORTHCAROLINACHANNELID:823487983742') {
            const value = call[2];
            expect(value).toEqual(
              expect.objectContaining({
                userPhoneNumber: '+1234567890',
                twilioPhoneNumber: '+12054985052',
              })
            );
          }
        }
      });
    });
  });
});

const handleDisclaimerWrapper = (
  userOptions,
  redisClient,
  twilioPhoneNumber,
  inboundDbMessageEntry
) => {
  return new Promise((resolve) => {
    resolve(
      Router.handleDisclaimer(
        userOptions,
        redisClient,
        twilioPhoneNumber,
        inboundDbMessageEntry
      )
    );
  });
};

describe('handleDisclaimer', () => {
  beforeEach(() => {
    requireModules();
    SlackApiUtil.sendMessage.mockResolvedValue({
      data: {
        ts: '823487983742',
        channel: 'CNORTHCAROLINACHANNELID',
      },
    });
  });

  describe('Runs regardless of whether voter is cleared', () => {
    beforeEach(() => {
      const userInfo = {
        activeChannelId: 'CTHELOBBYID',
        CTHELOBBYID: '293874928374',
        confirmedDisclaimer: false,
        isDemo: false,
        userId: '0923e1f4fb612739d9c5918c57656d5f',
      };

      const inboundDbMessageEntry = {
        mock: 'inboundDbMessageEntryData',
      };

      const twilioPhoneNumber = '+12054985052';
      return handleDisclaimerWrapper(
        {
          userPhoneNumber: '+1234567890',
          userMessage: 'response to state question',
          userInfo,
        },
        redisClient,
        twilioPhoneNumber,
        inboundDbMessageEntry
      );
    });

    test('Passes voter message to Slack lobby channel', () => {
      expect(SlackApiUtil.sendMessage.mock.calls[0][0]).toContain(
        'response to state question'
      );
      expect(SlackApiUtil.sendMessage.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          parentMessageTs: '293874928374',
          channel: 'CTHELOBBYID',
        })
      );
    });

    test('Passes inbound database entry object to SlackApiUtil for logging', () => {
      expect(SlackApiUtil.sendMessage.mock.calls[0][2]).toEqual(
        expect.objectContaining({
          mock: 'inboundDbMessageEntryData',
        })
      );
      // Ensure userInfo is passed to SlackApiUtil
      expect(SlackApiUtil.sendMessage.mock.calls[0][3]).not.toBeUndefined();
    });

    test('Includes updated lastVoterMessageSecsFromEpoch in inbound database entry object for logging', () => {
      const secsFromEpochNow = Math.round(Date.now() / 1000);
      const userInfo = SlackApiUtil.sendMessage.mock.calls[0][3];
      const newLastVoterMessageSecsFromEpoch =
        userInfo.lastVoterMessageSecsFromEpoch;
      expect(newLastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(
        10
      );
    });
  });

  describe('Voter is not cleared', () => {
    beforeEach(() => {
      const userInfo = {
        activeChannelId: 'CTHELOBBYID',
        CTHELOBBYID: '293874928374',
        confirmedDisclaimer: false,
        isDemo: false,
        userId: '0923e1f4fb612739d9c5918c57656d5f',
      };

      const inboundDbMessageEntry = {
        mock: 'inboundDbMessageEntryData',
      };

      const twilioPhoneNumber = '+12054985052';
      return handleDisclaimerWrapper(
        {
          userPhoneNumber: '+1234567890',
          userMessage: 'i dont agree',
          userInfo,
        },
        redisClient,
        twilioPhoneNumber,
        inboundDbMessageEntry
      );
    });

    test('Texts voter asking them again to agree to ToS disclaimer', () => {
      expect(TwilioApiUtil.sendMessage.mock.calls[0][0]).toEqual(
        expect.stringMatching(/to confirm that you understand/i)
      );
      expect(TwilioApiUtil.sendMessage.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          userPhoneNumber: '+1234567890',
          twilioPhoneNumber: '+12054985052',
        })
      );
    });

    test('Creates outbound database entry and passes to TwilioApiUtil for logging', () => {
      expect(TwilioApiUtil.sendMessage.mock.calls[0][2]).toEqual(
        expect.objectContaining({
          direction: 'OUTBOUND',
          automated: true,
        })
      );
    });

    test('Includes updated lastVoterMessageSecsFromEpoch in outbound database entry object for logging', () => {
      const secsFromEpochNow = Math.round(Date.now() / 1000);
      const dbMessageEntry = TwilioApiUtil.sendMessage.mock.calls[0][2];
      const newLastVoterMessageSecsFromEpoch =
        dbMessageEntry.lastVoterMessageSecsFromEpoch;
      expect(newLastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(
        10
      );
    });

    test('Passes to Slack message asking voter again to agree to ToS disclaimer', () => {
      expect(SlackApiUtil.sendMessage.mock.calls[1][0]).toEqual(
        expect.stringMatching(/to confirm that you understand/i)
      );
      expect(SlackApiUtil.sendMessage.mock.calls[1][1]).toEqual(
        expect.objectContaining({
          parentMessageTs: '293874928374',
          channel: 'CTHELOBBYID',
        })
      );
    });

    test('Preserves unchanged redisClient Twilio-to-Slack lookup data', () => {
      expect.assertions(1);
      const MD5 = new Hashes.MD5();
      const userId = MD5.hex('+1234567890');
      for (call of RedisApiUtil.setHash.mock.calls) {
        const key = call[1];
        if (key === `${userId}:+12054985052`) {
          const value = call[2];
          expect(value).toEqual(
            expect.objectContaining({
              activeChannelId: 'CTHELOBBYID',
              CTHELOBBYID: '293874928374',
              isDemo: false,
            })
          );
        }
      }
    });

    test('Does not update redisClient Twilio-to-Slack lookup for confirmedDisclaimer, keeping it false', () => {
      expect.assertions(1);
      const MD5 = new Hashes.MD5();
      const userId = MD5.hex('+1234567890');
      for (call of RedisApiUtil.setHash.mock.calls) {
        const key = call[1];
        if (key === `${userId}:+12054985052`) {
          const value = call[2];
          expect(value).toEqual(
            expect.objectContaining({
              confirmedDisclaimer: false,
            })
          );
        }
      }
    });

    test('Updates redisClient Twilio-to-Slack lookup with lastVoterMessageSecsFromEpoch', () => {
      const secsFromEpochNow = Math.round(Date.now() / 1000);
      const key = call[1];
      const MD5 = new Hashes.MD5();
      const userId = MD5.hex('+1234567890');
      for (call of RedisApiUtil.setHash.mock.calls) {
        if (key === `${userId}:+12054985052`) {
          const value = call[2];
          const lastVoterMessageSecsFromEpoch =
            value.lastVoterMessageSecsFromEpoch;
          expect(lastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(
            10
          );
        }
      }
    });
  });

  describe('Voter is cleared', () => {
    beforeEach(() => {
      const userInfo = {
        activeChannelId: 'CTHELOBBYID',
        CTHELOBBYID: '293874928374',
        confirmedDisclaimer: false,
        isDemo: false,
        userId: '0923e1f4fb612739d9c5918c57656d5f',
      };

      const inboundDbMessageEntry = {
        mock: 'inboundDbMessageEntryData',
      };

      const twilioPhoneNumber = '+12054985052';
      return handleDisclaimerWrapper(
        {
          userPhoneNumber: '+1234567890',
          userMessage: 'agree',
          userInfo,
        },
        redisClient,
        twilioPhoneNumber,
        inboundDbMessageEntry
      );
    });

    test('Texts voter confirming disclaimer agreement and asking for voter U.S. state', () => {
      expect(TwilioApiUtil.sendMessage.mock.calls[0][0]).toEqual(
        expect.stringMatching(/Great!.*in which U.S. state/i)
      );
      expect(TwilioApiUtil.sendMessage.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          userPhoneNumber: '+1234567890',
          twilioPhoneNumber: '+12054985052',
        })
      );
    });

    test('Creates outbound database entry and passes to TwilioApiUtil for logging', () => {
      expect(TwilioApiUtil.sendMessage.mock.calls[0][2]).toEqual(
        expect.objectContaining({
          direction: 'OUTBOUND',
          automated: true,
        })
      );
    });

    test('Includes updated lastVoterMessageSecsFromEpoch in outbound database entry object for logging', () => {
      const secsFromEpochNow = Math.round(Date.now() / 1000);
      const dbMessageEntry = TwilioApiUtil.sendMessage.mock.calls[0][2];
      const newLastVoterMessageSecsFromEpoch =
        dbMessageEntry.lastVoterMessageSecsFromEpoch;
      expect(newLastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(
        10
      );
    });

    test('Passes to Slack message confirming disclaimer agreement and asking for voter U.S. state', () => {
      expect(SlackApiUtil.sendMessage.mock.calls[1][0]).toEqual(
        expect.stringMatching(/Great!.*in which U.S. state/i)
      );
      expect(SlackApiUtil.sendMessage.mock.calls[1][1]).toEqual(
        expect.objectContaining({
          parentMessageTs: '293874928374',
          channel: 'CTHELOBBYID',
        })
      );
    });

    test('Preserves unchanged redisClient Twilio-to-Slack lookup data', () => {
      expect.assertions(1);
      const MD5 = new Hashes.MD5();
      const userId = MD5.hex('+1234567890');
      for (call of RedisApiUtil.setHash.mock.calls) {
        const key = call[1];
        if (key === `${userId}:+12054985052`) {
          const value = call[2];
          expect(value).toEqual(
            expect.objectContaining({
              activeChannelId: 'CTHELOBBYID',
              CTHELOBBYID: '293874928374',
              isDemo: false,
            })
          );
        }
      }
    });

    test('Updates redisClient Twilio-to-Slack lookup with confirmedDisclaimer:true', () => {
      expect.assertions(1);
      const MD5 = new Hashes.MD5();
      const userId = MD5.hex('+1234567890');
      for (call of RedisApiUtil.setHash.mock.calls) {
        const key = call[1];
        if (key === `${userId}:+12054985052`) {
          const value = call[2];
          expect(value).toEqual(
            expect.objectContaining({
              confirmedDisclaimer: true,
            })
          );
        }
      }
    });

    test('Updates redisClient Twilio-to-Slack lookup with lastVoterMessageSecsFromEpoch', () => {
      const secsFromEpochNow = Math.round(Date.now() / 1000);
      for (call of RedisApiUtil.setHash.mock.calls) {
        const key = call[1];
        if (key === '+1234567890:+12054985052') {
          const value = call[2];
          const lastVoterMessageSecsFromEpoch =
            value.lastVoterMessageSecsFromEpoch;
          expect(lastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(
            10
          );
        }
      }
    });
  });
});

const handleClearedVoterWrapper = (
  userOptions,
  redisClient,
  twilioPhoneNumber,
  inboundDbMessageEntry
) => {
  return new Promise((resolve) => {
    resolve(
      Router.handleClearedVoter(
        userOptions,
        redisClient,
        twilioPhoneNumber,
        inboundDbMessageEntry
      )
    );
  });
};

describe('handleClearedVoter', () => {
  beforeEach(() => {
    requireModules();
    SlackApiUtil.sendMessage.mockResolvedValue({
      data: {
        ts: '823487983742',
        channel: 'CNORTHCAROLINACHANNELID',
      },
    });
  });

  test('Passes voter message to Slack', () => {
    const userInfo = {
      activeChannelId: 'CNORTHCAROLINACHANNELID',
      CNORTHCAROLINACHANNELID: '823487983742',
      CTHELOBBYID: '293874928374',
      confirmedDisclaimer: true,
      isDemo: false,
      userId: '0923e1f4fb612739d9c5918c57656d5f',
    };

    const inboundDbMessageEntry = {
      mock: 'inboundDbMessageEntryData',
    };

    const twilioPhoneNumber = '+12054985052';
    return handleClearedVoterWrapper(
      {
        userPhoneNumber: '+1234567890',
        userMessage: 'subsequent message',
        userInfo,
      },
      redisClient,
      twilioPhoneNumber,
      inboundDbMessageEntry
    ).then(() => {
      expect(SlackApiUtil.sendMessage.mock.calls[0][0]).toContain(
        'subsequent message'
      );
    });
  });

  test('Passes inbound database entry object to SlackApiUtil for logging', () => {
    const userInfo = {
      activeChannelId: 'CNORTHCAROLINACHANNELID',
      CNORTHCAROLINACHANNELID: '823487983742',
      CTHELOBBYID: '293874928374',
      confirmedDisclaimer: true,
      isDemo: false,
      userId: '0923e1f4fb612739d9c5918c57656d5f',
    };

    const inboundDbMessageEntry = {
      mock: 'inboundDbMessageEntryData',
    };

    const twilioPhoneNumber = '+12054985052';
    return handleClearedVoterWrapper(
      {
        userPhoneNumber: '+1234567890',
        userMessage: 'subsequent message',
        userInfo,
      },
      redisClient,
      twilioPhoneNumber,
      inboundDbMessageEntry
    ).then(() => {
      expect(SlackApiUtil.sendMessage.mock.calls[0][2]).toEqual(
        expect.objectContaining({
          mock: 'inboundDbMessageEntryData',
        })
      );
      expect(SlackApiUtil.sendMessage.mock.calls[0][3]).not.toBeUndefined();
    });
  });

  test('Includes updated lastVoterMessageSecsFromEpoch in inbound database entry object for logging', () => {
    const userInfo = {
      activeChannelId: 'CNORTHCAROLINACHANNELID',
      CNORTHCAROLINACHANNELID: '823487983742',
      CTHELOBBYID: '293874928374',
      confirmedDisclaimer: true,
      isDemo: false,
      userId: '0923e1f4fb612739d9c5918c57656d5f',
    };

    const inboundDbMessageEntry = {
      mock: 'inboundDbMessageEntryData',
    };

    const twilioPhoneNumber = '+12054985052';
    return handleClearedVoterWrapper(
      {
        userPhoneNumber: '+1234567890',
        userMessage: 'subsequent message',
        userInfo,
      },
      redisClient,
      twilioPhoneNumber,
      inboundDbMessageEntry
    ).then(() => {
      const secsFromEpochNow = Math.round(Date.now() / 1000);
      const userInfo = SlackApiUtil.sendMessage.mock.calls[0][3];
      const newLastVoterMessageSecsFromEpoch =
        userInfo.lastVoterMessageSecsFromEpoch;
      expect(newLastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(
        10
      );
    });
  });

  test("Sends voter a welcome back text if it's been longer than 24 hours", () => {
    expect.assertions(2);
    const twentyFourHoursAndOneMinInSecs = 60 * 60 * 24 + 60;
    const mockLastVoterMessageSecsFromEpoch = Math.round(
      Date.now() / 1000 - twentyFourHoursAndOneMinInSecs
    );
    const userInfo = {
      activeChannelId: 'CNORTHCAROLINACHANNELID',
      CNORTHCAROLINACHANNELID: '823487983742',
      CTHELOBBYID: '293874928374',
      confirmedDisclaimer: true,
      isDemo: false,
      lastVoterMessageSecsFromEpoch: mockLastVoterMessageSecsFromEpoch,
      userId: '0923e1f4fb612739d9c5918c57656d5f',
    };

    const inboundDbMessageEntry = {
      mock: 'inboundDbMessageEntryData',
    };

    const twilioPhoneNumber = '+12054985052';
    return handleClearedVoterWrapper(
      {
        userPhoneNumber: '+1234567890',
        userMessage: 'subsequent message',
        userInfo,
      },
      redisClient,
      twilioPhoneNumber,
      inboundDbMessageEntry
    ).then(() => {
      expect(TwilioApiUtil.sendMessage.mock.calls[0][0]).toEqual(
        expect.stringMatching(/Welcome back/i)
      );
      expect(TwilioApiUtil.sendMessage.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          userPhoneNumber: '+1234567890',
          twilioPhoneNumber: '+12054985052',
        })
      );
    });
  });

  test('Does not send an automated reply if last message is within 1 hour', () => {
    expect.assertions(1);
    const oneMinShyOfOneHourInSecs = 60 * 60 - 60;
    const mockLastVoterMessageSecsFromEpoch = Math.round(
      Date.now() / 1000 - oneMinShyOfOneHourInSecs
    );
    const userInfo = {
      activeChannel: 'CNORTHCAROLINACHANNELID',
      CNORTHCAROLINACHANNELID: '823487983742',
      CTHELOBBYID: '293874928374',
      confirmedDisclaimer: true,
      isDemo: false,
      lastVoterMessageSecsFromEpoch: mockLastVoterMessageSecsFromEpoch,
      userId: '0923e1f4fb612739d9c5918c57656d5f',
    };

    const inboundDbMessageEntry = {
      mock: 'inboundDbMessageEntryData',
    };

    const twilioPhoneNumber = '+12054985052';
    return handleClearedVoterWrapper(
      {
        userPhoneNumber: '+1234567890',
        userMessage: 'subsequent message',
        userInfo,
      },
      redisClient,
      twilioPhoneNumber,
      inboundDbMessageEntry
    ).then(() => {
      expect(TwilioApiUtil.sendMessage).not.toHaveBeenCalled();
    });
  });

  test('Updates redisClient Twilio-to-Slack lookup with lastVoterMessageSecsFromEpoch', () => {
    expect.assertions(1);
    const userInfo = {
      activeChannelId: 'CNORTHCAROLINACHANNELID',
      CNORTHCAROLINACHANNELID: '823487983742',
      CTHELOBBYID: '293874928374',
      confirmedDisclaimer: true,
      isDemo: false,
      userId: '0923e1f4fb612739d9c5918c57656d5f',
    };

    const inboundDbMessageEntry = {
      mock: 'inboundDbMessageEntryData',
    };

    const twilioPhoneNumber = '+12054985052';
    return handleClearedVoterWrapper(
      {
        userPhoneNumber: '+1234567890',
        userMessage: 'subsequent message',
        userInfo,
      },
      redisClient,
      twilioPhoneNumber,
      inboundDbMessageEntry
    ).then(() => {
      const secsFromEpochNow = Math.round(Date.now() / 1000);
      const MD5 = new Hashes.MD5();
      const userId = MD5.hex('+1234567890');
      for (call of RedisApiUtil.setHash.mock.calls) {
        const key = call[1];
        if (key === `${userId}:+12054985052`) {
          const value = call[2];
          const lastVoterMessageSecsFromEpoch =
            value.lastVoterMessageSecsFromEpoch;
          expect(lastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(
            10
          );
        }
      }
    });
  });
});
