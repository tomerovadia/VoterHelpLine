const requireModules = () => {
  RouterUtil = require('./router_util');
  MessageParserUtil = require('./message_parser_util');
  TwilioApiUtil = require('./twilio_api_util');
  SlackApiUtil = require('./slack_api_util');
  RedisApiUtil = require('./redis_api_util');
  Hashes = require('jshashes'); // v1.0.5
  redis = require("redis-mock"), redisClient = redis.createClient();

  jest.mock('./twilio_api_util');
  jest.mock('./message_parser_util');

  SlackApiUtil.sendMessage = jest.fn();
  RedisApiUtil.setHash = jest.fn();
};

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
});

// expectNthSlackMessageToChannel tests the Nth (0-indexed) slack message sent to the given
// channel to make sure the message contains the given message string segments
// and (optionally) was sent to the given thread (parentMessageTs).
const expectNthSlackMessageToChannel = (channel, n, messageParts, parentMessageTs, skipAssertions) => {
  const numAssertions = parentMessageTs ? messageParts.length + 1 : messageParts.length;
  if (!skipAssertions) {
    expect.assertions(numAssertions);
  }
  let lobbyMessageNum = -1;
  for (let i = 0; i < SlackApiUtil.sendMessage.mock.calls.length; i++) {
    const slackMessageParams = SlackApiUtil.sendMessage.mock.calls[i][1];
    if (slackMessageParams.channel == channel) {
      lobbyMessageNum++;
      if (lobbyMessageNum == n) {
        const slackMessage = SlackApiUtil.sendMessage.mock.calls[i][0];
        for (let j = 0; j < messageParts.length; j++) {
          expect(slackMessage).toEqual(expect.stringContaining(messageParts[j]));
        }
        if (parentMessageTs) {
          expect(slackMessageParams).toEqual(expect.objectContaining({
            parentMessageTs,
          }));
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

const handleNewVoterWrapper = (userOptions, redisClient, twilioPhoneNumber, inboundDbMessageEntry) => {
  return new Promise((resolve, reject) => {
    resolve(RouterUtil.handleNewVoter(userOptions, redisClient, twilioPhoneNumber, inboundDbMessageEntry));
  });
};

describe('handleNewVoter', () => {
  beforeEach(() => {
    requireModules();
    SlackApiUtil.sendMessage.mockResolvedValue({
      data: {
        ts: "293874928374",
        channel: "#lobby"
      }
    });

    const inboundDbMessageEntry = {
      mock: "inboundDbMessageEntryData",
    };

    return handleNewVoterWrapper({
      userPhoneNumber: "+1234567890",
      userMessage: "can you help me vote",
    }, redisClient, "+12054985052", inboundDbMessageEntry);
  });

  test("Announces new voter message in Slack", () => {
    expect(SlackApiUtil.sendMessage.mock.calls[0][0]).toContain("New voter");
  });

  test("Announces new voter message to Slack #lobby channel if non-demo line", () => {
    expect(SlackApiUtil.sendMessage.mock.calls[0][1].channel).toBe("#lobby");
  });

  test("Announces new voter message to Slack #demo-lobby channel if demo line", () => {
    jest.clearAllMocks();
    const inboundDbMessageEntry = {};
    return handleNewVoterWrapper({
      userPhoneNumber: "+1234567890",
      userMessage: "can you help me vote",
    }, redisClient, "+15619338683", inboundDbMessageEntry).then(() => {
      expect(SlackApiUtil.sendMessage.mock.calls[0][1].channel).toBe("#demo-lobby");
    });
  });

  test("Includes truncated user id in new voter announcement in Slack", () => {
    const MD5 = new Hashes.MD5;
    const userId = MD5.hex("+1234567890");
    expect(SlackApiUtil.sendMessage.mock.calls[0][0]).toContain(userId.substring(0, 5));
  });

  test("Relays voter message in subsequent message to Slack", () => {
    expect(SlackApiUtil.sendMessage.mock.calls[1][0]).toEqual(expect.stringContaining("can you help me vote"));
    expect(SlackApiUtil.sendMessage.mock.calls[1][1]).toEqual(expect.objectContaining({
      parentMessageTs: "293874928374",
      channel: "#lobby",
    }));
  });

  test("Passes inbound database entry object to SlackApiUtil for logging", () => {
    expect(SlackApiUtil.sendMessage.mock.calls[1][2]).toEqual(expect.objectContaining({
      mock: "inboundDbMessageEntryData",
    }));
    // Ensure userInfo is passed to SlackApiUtil
    expect(SlackApiUtil.sendMessage.mock.calls[1][3]).not.toBeUndefined();
  });

  test("Includes updated lastVoterMessageSecsFromEpoch in inbound database entry object for logging", () => {
    const secsFromEpochNow = Math.round(Date.now() / 1000);
    const userInfo = SlackApiUtil.sendMessage.mock.calls[1][3];
    const newLastVoterMessageSecsFromEpoch = userInfo.lastVoterMessageSecsFromEpoch;
    expect(newLastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(10);
  });

  test("Includes truncated user id in relay of voter message", () => {
    const MD5 = new Hashes.MD5;
    const userId = MD5.hex("+1234567890");
    expect(SlackApiUtil.sendMessage.mock.calls[1][0]).toEqual(expect.stringContaining(userId.substring(0, 5)));
  });

  test("Relays automated welcoming of voter to Slack", () => {
    expect(SlackApiUtil.sendMessage.mock.calls[2][0]).toEqual(expect.stringContaining("Welcome"));
  });

  test("Sends one response to the user", () => {
    expect(TwilioApiUtil.sendMessage).toHaveBeenCalledTimes(1);
  });

  test("Sends one response to the user with welcome and disclaimer", () => {
    expect(TwilioApiUtil.sendMessage.mock.calls[0][0]).toEqual(expect.stringMatching(/welcome/i));
    expect(TwilioApiUtil.sendMessage.mock.calls[0][0]).toEqual(expect.stringMatching(/you release Voter Help Line of all liability/i));
    expect(TwilioApiUtil.sendMessage.mock.calls[0][1]).toEqual(expect.objectContaining({
      twilioPhoneNumber: "+12054985052",
      userPhoneNumber: "+1234567890",
    }));
  });

  test("Creates outbound database entry and passes to TwilioApiUtil for logging", () => {
    expect(TwilioApiUtil.sendMessage.mock.calls[0][2]).toEqual(expect.objectContaining({
      direction: "OUTBOUND",
      automated: true,
    }));
  });

  test("Includes updated lastVoterMessageSecsFromEpoch in outbound database entry object for logging", () => {
    const secsFromEpochNow = Math.round(Date.now() / 1000);
    const dbMessageEntry = TwilioApiUtil.sendMessage.mock.calls[0][2];
    const newLastVoterMessageSecsFromEpoch = dbMessageEntry.lastVoterMessageSecsFromEpoch;
    expect(newLastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(10);
  });

  test("Adds two hashes to redisClient", () => {
    expect(RedisApiUtil.setHash).toHaveBeenCalledTimes(2);
  });

  test("Adds redisClient Twilio-to-Slack lookup with userPhoneNumber:TwilioPhoneNumber key", () => {
    expect(RedisApiUtil.setHash.mock.calls).toEqual(expect.arrayContaining([expect.arrayContaining(["+1234567890:+12054985052"])]));
  });

  test("Adds redisClient Twilio-to-Slack lookup with Slack channel", () => {
    expect.assertions(1);
    for (call of RedisApiUtil.setHash.mock.calls) {
      const key = call[1];
      if (key == "+1234567890:+12054985052") {
        const value = call[2];
        expect(value.lobbyChannel).toEqual("#lobby");
      }
    }
  });

  test("Adds redisClient Twilio-to-Slack lookup with Slack thread", () => {
    expect.assertions(1);
    for (call of RedisApiUtil.setHash.mock.calls) {
      const key = call[1];
      if (key == "+1234567890:+12054985052") {
        const value = call[2];
        expect(value.lobbyParentMessageTs).toEqual("293874928374");
      }
    }
  });

  test("Adds redisClient Twilio-to-Slack lookup with isDemo:true for demo line", () => {
    expect.assertions(1);
    jest.clearAllMocks();
    const inboundDbMessageEntry = {};
    return handleNewVoterWrapper({
      userPhoneNumber: "+1234567890",
      userMessage: "can you help me vote",
    }, redisClient, "+15619338683", inboundDbMessageEntry).then(() => {
      for (call of RedisApiUtil.setHash.mock.calls) {
        const key = call[1];
        if (key == "+1234567890:+15619338683") {
          const value = call[2];
          expect(value).toEqual(expect.objectContaining({isDemo: true}));
        }
      }
    });
  });

  test("Adds redisClient Twilio-to-Slack lookup with isDemo:false for non-demo line", () => {
    expect.assertions(1);
    for (call of RedisApiUtil.setHash.mock.calls) {
      const key = call[1];
      if (key == "+1234567890:+12054985052") {
        const value = call[2];
        expect(value).toEqual(expect.objectContaining({isDemo: false}));
      }
    }
  });

  test("Adds redisClient Twilio-to-Slack lookup with confirmedDisclaimer:false", () => {
    expect.assertions(1);
    for (call of RedisApiUtil.setHash.mock.calls) {
      const key = call[1];
      if (key == "+1234567890:+12054985052") {
        const value = call[2];
        expect(value).toEqual(expect.objectContaining({confirmedDisclaimer: false}));
      }
    }
  });

  test("Adds redisClient Twilio-to-Slack lookup with messageHistory", () => {
    expect.assertions(1);
    for (call of RedisApiUtil.setHash.mock.calls) {
      const key = call[1];
      if (key == "+1234567890:+12054985052") {
        const value = call[2];
        expect(value).toEqual(expect.objectContaining({messageHistory: expect.arrayContaining([
          expect.stringContaining("can you help me vote"),
          expect.stringContaining("Welcome"),
        ])}));
      }
    }
  });

  test("Adds redisClient Twilio-to-Slack lookup with lastVoterMessageSecsFromEpoch", () => {
    expect.assertions(1);
    const secsFromEpochNow = Math.round(Date.now() / 1000);
    for (call of RedisApiUtil.setHash.mock.calls) {
      const key = call[1];
      if (key == "+1234567890:+12054985052") {
        const value = call[2];
        const lastVoterMessageSecsFromEpoch = value.lastVoterMessageSecsFromEpoch;
        expect(lastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(10);
      }
    }
  });

  test("Adds redisClient Slack-to-Twilio lookup", () => {
    expect(RedisApiUtil.setHash.mock.calls).toEqual(expect.arrayContaining([expect.arrayContaining(["#lobby:293874928374"])]));
  });

  test("Adds redisClient Slack-to-Twilio lookup with user phone number", () => {
    expect.assertions(1);
    for (call of RedisApiUtil.setHash.mock.calls) {
      const key = call[1];
      if (key == "#lobby:293874928374") {
        const value = call[2];
        expect(value).toEqual(expect.objectContaining({userPhoneNumber: "+1234567890"}));
      }
    }
  });

  test("Adds redisClient Slack-to-Twilio lookup with Twilio phone number", () => {
    for (call of RedisApiUtil.setHash.mock.calls) {
      const key = call[1];
      if (key == "#lobby:293874928374") {
        const value = call[2];
        expect(value).toEqual(expect.objectContaining({twilioPhoneNumber: "+12054985052"}));
      }
    }
  });
});

const determineVoterStateWrapper = (userOptions, redisClient, twilioPhoneNumber, inboundDbMessageEntry) => {
  return new Promise((resolve, reject) => {
    resolve(RouterUtil.determineVoterState(userOptions, redisClient, twilioPhoneNumber, inboundDbMessageEntry));
  });
};

describe('determineVoterState', () => {
  beforeEach(() => {
    requireModules();
  });

  describe("Runs regardless of whether U.S. state identified successfully", () => {
    beforeEach(() => {
      SlackApiUtil.sendMessage.mockResolvedValue({
        data: {
          ts: "293874928374",
          channel: "#lobby"
        }
      });

      const inboundDbMessageEntry = {
        mock: "inboundDbMessageEntryData",
      };

      return determineVoterStateWrapper({
        userPhoneNumber: "+1234567890",
        userMessage: "nonsensical statement",
        userInfo: {
          lobbyChannel: "#lobby",
          lobbyParentMessageTs: "293874928374",
          confirmedDisclaimer: false,
          isDemo: false,
          messageHistory: [
            "can you help me vote",
            "Welcome to the Voter Help Line!"
          ],
          userId: "0923e",
        },
      }, redisClient, "+12054985052", inboundDbMessageEntry);
    });
    test("Passes voter message to Slack", () => {
      expect(SlackApiUtil.sendMessage.mock.calls[0][0]).toContain("nonsensical statement");
    });

    test("Includes truncated user id in passing voter message to Slack", () => {
      const MD5 = new Hashes.MD5;
      const userId = MD5.hex("+1234567890");
      expect(SlackApiUtil.sendMessage.mock.calls[0][0]).toContain(userId.substring(0, 5));
    });

    test("Sends voter message to voter's channel/thread in Slack lobby", () => {
      expect(SlackApiUtil.sendMessage.mock.calls[0][1]).toEqual(expect.objectContaining({
        parentMessageTs: "293874928374",
        channel: "#lobby",
      }));
    });

    test("Passes inbound database entry object to SlackApiUtil for logging", () => {
      expect(SlackApiUtil.sendMessage.mock.calls[0][2]).toEqual(expect.objectContaining({
        mock: "inboundDbMessageEntryData",
      }));
      // Ensure userInfo is passed to SlackApiUtil
      expect(SlackApiUtil.sendMessage.mock.calls[0][3]).not.toBeUndefined();
    });

    test("Includes updated lastVoterMessageSecsFromEpoch in inbound database entry object for logging", () => {
      const secsFromEpochNow = Math.round(Date.now() / 1000);
      const userInfo = SlackApiUtil.sendMessage.mock.calls[0][3];
      const newLastVoterMessageSecsFromEpoch = userInfo.lastVoterMessageSecsFromEpoch;
      expect(newLastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(10);
    });
  });

  describe("Couldn't determine voter U.S. state", () => {
    beforeEach(() => {
      MessageParserUtil.determineState.mockReturnValue(null);
      SlackApiUtil.sendMessage.mockResolvedValue({
        data: {
          ts: "293874928374",
          channel: "#lobby"
        }
      });

      const inboundDbMessageEntry = {
        mock: "inboundDbMessageEntryData",
      };

      return determineVoterStateWrapper({
        userPhoneNumber: "+1234567890",
        userMessage: "nonsensical statement",
        userInfo: {
          lobbyChannel: "#lobby",
          lobbyParentMessageTs: "293874928374",
          confirmedDisclaimer: false,
          isDemo: false,
          messageHistory: [
            "can you help me vote",
            "Welcome to the Voter Help Line! We are finding an available volunteer -- in the meantime, please tell us more about how we can help you vote. Please note that we currently only service North Carolina. (Msg & data rates may apply)."
          ],
          userId: "0923e",
        },
      }, redisClient, "+12054985052", inboundDbMessageEntry);
    });

    test("Sends a message to voter clarifying if U.S. state wasn't recognized", () => {
      expect(TwilioApiUtil.sendMessage.mock.calls[0][0]).toContain("didn't understand");
      expect(TwilioApiUtil.sendMessage.mock.calls[0][1]).toEqual(expect.objectContaining({
        userPhoneNumber: "+1234567890",
        twilioPhoneNumber: "+12054985052",
      }));
    });

    test("Creates outbound database entry and passes to TwilioApiUtil for logging", () => {
      expect(TwilioApiUtil.sendMessage.mock.calls[0][2]).toEqual(expect.objectContaining({
        direction: "OUTBOUND",
        automated: true,
      }));
    });

    test("Includes updated lastVoterMessageSecsFromEpoch in outbound database entry object for logging", () => {
      const secsFromEpochNow = Math.round(Date.now() / 1000);
      const dbMessageEntry = TwilioApiUtil.sendMessage.mock.calls[0][2];
      const newLastVoterMessageSecsFromEpoch = dbMessageEntry.lastVoterMessageSecsFromEpoch;
      expect(newLastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(10);
    });

    test("Sends copy of message clarifying U.S. state to Slack", () => {
      expect(SlackApiUtil.sendMessage.mock.calls[1][0]).toContain("didn't understand");
      expect(SlackApiUtil.sendMessage.mock.calls[1][1]).toEqual(expect.objectContaining({
        parentMessageTs: "293874928374",
        channel: "#lobby",
      }));
    });

    test("Updates redisClient Twilio-to-Slack lookup with lastVoterMessageSecsFromEpoch", () => {
      const secsFromEpochNow = Math.round(Date.now() / 1000);
      for (call of RedisApiUtil.setHash.mock.calls) {
        const key = call[1];
        if (key == "+1234567890:+12054985052") {
          const value = call[2];
          const lastVoterMessageSecsFromEpoch = value.lastVoterMessageSecsFromEpoch;
          expect(lastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(10);
        }
      }
    });

    test("Adds new messages to redisClient Twilio-to-Slack lookup messageHistory", () => {
      expect.assertions(1);
      for (call of RedisApiUtil.setHash.mock.calls) {
        const key = call[1];
        if (key == "+1234567890:+12054985052") {
          const value = call[2];
          expect(value).toEqual(expect.objectContaining({messageHistory: expect.arrayContaining([
            expect.stringContaining("nonsensical statement"),
            expect.stringContaining("didn't understand"),
          ])}));
        }
      }
    });

    test("Keeps old messages in redisClient Twilio-to-Slack lookup messageHistory", () => {
      expect.assertions(1);
      for (call of RedisApiUtil.setHash.mock.calls) {
        const key = call[1];
        if (key == "+1234567890:+12054985052") {
          const value = call[2];
          expect(value).toEqual(expect.objectContaining({messageHistory: expect.arrayContaining([
            expect.stringContaining("can you help me vote"),
            expect.stringContaining("Welcome to the Voter Help Line! We are finding an available volunteer -- in the meantime, please tell us more about how we can help you vote. Please note that we currently only service North Carolina. (Msg & data rates may apply)."),
          ])}));
        }
      }
    });
  });

  describe("Successfully determined voter U.S. state", () => {
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
          ts: "293874928374",
          channel: "#lobby"
        }
      };

      stateSlackMessageResponse = {
        data: {
          ts: "823487983742",
          // In the wild this is actually a channel ID (e.g. C12345678)
          channel: "north-carolina-0"
        }
      };

      MessageParserUtil.determineState.mockReturnValue("North Carolina");

      // This default response will kick in once the mockResolvedValueOnce calls run out.
      SlackApiUtil.sendMessage.mockResolvedValue(lobbySlackMessageResponse);

      // This is a bit hacky. Because the calls are async, the messages send
      // simultaneously to lobby and state channels. Second message sent happens
      // to be to state channel (which sort of makes sense when you think about it).
      SlackApiUtil.sendMessage.mockResolvedValueOnce(lobbySlackMessageResponse).mockResolvedValueOnce(stateSlackMessageResponse);

      // Mock these functions, as they are called by load balancer.
      redisClient.setAsync = jest.fn();
      redisClient.mgetAsync = jest.fn();
      // Load balancer requires a return value from this function, so mock it.
      redisClient.mgetAsync.mockResolvedValue(["1", "0"]);

      inboundDbMessageEntry = {
        mock: "inboundDbMessageEntryData",
      };

      userInfo = {
        lobbyChannel: "#lobby",
        lobbyParentMessageTs: "293874928374",
        confirmedDisclaimer: false,
        isDemo: false,
        userId: "0923e",
        messageHistory: [
          "0923e: can you help me vote",
          "Welcome to the Voter Help Line! To match you with the most knowlegeable volunteer, in which U.S. state are you looking to vote? We currently service FL, NC and OH. (Msg & data rates may apply).",
        ],
        userId: "0923e",
      };

      twilioPhoneNumber = "+12054985052";

      // Leave the calling of determineVoterStateWrapper to each test so that
      // the above variables and mocks can be modified if needed (e.g. for
      // the round robin).
    });

    test("Texts voter confirming U.S. state and informing of retrieving volunteer", () => {
      return determineVoterStateWrapper({
        userPhoneNumber: "+1234567890",
        userMessage: "NC",
        userInfo,
      }, redisClient, twilioPhoneNumber, inboundDbMessageEntry).then(() => {
        expect(TwilioApiUtil.sendMessage.mock.calls[0][0]).toEqual(expect.stringMatching(/Great!.*We try to reply within minutes but may take up to 24 hours./i));
        expect(TwilioApiUtil.sendMessage.mock.calls[0][1]).toEqual(expect.objectContaining({
          userPhoneNumber: "+1234567890",
          twilioPhoneNumber: "+12054985052",
        }));
      });
    });

    test("Creates outbound database entry and passes to TwilioApiUtil for logging", () => {
      return determineVoterStateWrapper({
        userPhoneNumber: "+1234567890",
        userMessage: "NC",
        userInfo,
      }, redisClient, twilioPhoneNumber, inboundDbMessageEntry).then(() => {
        expect(TwilioApiUtil.sendMessage.mock.calls[0][2]).toEqual(expect.objectContaining({
          direction: "OUTBOUND",
          automated: true,
        }));
      });
    });

    test("Includes updated lastVoterMessageSecsFromEpoch in outbound database entry object for logging", () => {
      return determineVoterStateWrapper({
        userPhoneNumber: "+1234567890",
        userMessage: "NC",
        userInfo,
      }, redisClient, twilioPhoneNumber, inboundDbMessageEntry).then(() => {
        const secsFromEpochNow = Math.round(Date.now() / 1000);
        const dbMessageEntry = TwilioApiUtil.sendMessage.mock.calls[0][2];
        const newLastVoterMessageSecsFromEpoch = dbMessageEntry.lastVoterMessageSecsFromEpoch;
        expect(newLastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(10);
      });
    });

    test("Relays voter text to Slack lobby", () => {
      return determineVoterStateWrapper({
        userPhoneNumber: "+1234567890",
        userMessage: "NC",
        userInfo,
      }, redisClient, twilioPhoneNumber, inboundDbMessageEntry).then(() => {
        expectNthSlackMessageToChannel("#lobby", 0, ["NC"], "293874928374");
      });
    });

    test("Sends copy of U.S. state confirmation message to Slack lobby", () => {
      return determineVoterStateWrapper({
        userPhoneNumber: "+1234567890",
        userMessage: "NC",
        userInfo,
      }, redisClient, twilioPhoneNumber, inboundDbMessageEntry).then(() => {
        expectNthSlackMessageToChannel("#lobby", 1, ["We try to reply within minutes but may take up to 24 hours."], "293874928374");
      });
    });

    test("Sends operator message to lobby announcing voter is being routed", () => {
      return determineVoterStateWrapper({
        userPhoneNumber: "+1234567890",
        userMessage: "NC",
        userInfo,
      }, redisClient, twilioPhoneNumber, inboundDbMessageEntry).then(() => {
        expectNthSlackMessageToChannel("#lobby", 2, ["Routing voter"], "293874928374");
      });
    });

    test("Sends first Slack message to U.S. state channel announcing voter with truncated user id", () => {
      return determineVoterStateWrapper({
        userPhoneNumber: "+1234567890",
        userMessage: "NC",
        userInfo,
      }, redisClient, twilioPhoneNumber, inboundDbMessageEntry).then(() => {
        const MD5 = new Hashes.MD5;
        const userId = MD5.hex("+1234567890").substring(0, 5);
        expectNthSlackMessageToChannel("north-carolina-0", 0, ["New North Carolina voter", userId]);
      });
    });

    test("Sends first voter to Slack channel for first pod in U.S. state", () => {
      return determineVoterStateWrapper({
        userPhoneNumber: "+1234567890",
        userMessage: "NC",
        userInfo,
      }, redisClient, twilioPhoneNumber, inboundDbMessageEntry).then(() => {
        expectNthSlackMessageToChannel("north-carolina-0", 0, ["New North Carolina voter"]);
      });
    });

    test("Sends second voter to Slack channel for second pod in U.S. state, if more than one pods exists", () => {
        redisClient.mgetAsync = jest.fn();
        redisClient.mgetAsync.mockResolvedValue(["2" /* num pods */, "1" /* num (previous) voters*/]);
        return determineVoterStateWrapper({
          userPhoneNumber: "+1234567890",
          userMessage: "NC",
          userInfo,
        }, redisClient, twilioPhoneNumber, inboundDbMessageEntry).then(() => {
          expectNthSlackMessageToChannel("north-carolina-1", 0, ["New North Carolina voter"]);
        });
    });

    test("Sends third voter to Slack channel for first pod in U.S. state, if only two pods exist", () => {
        redisClient.mgetAsync = jest.fn();
        redisClient.mgetAsync.mockResolvedValue(["2" /* num pods */, "2" /* num (previous) voters*/]);
        return determineVoterStateWrapper({
          userPhoneNumber: "+1234567890",
          userMessage: "NC",
          userInfo,
        }, redisClient, twilioPhoneNumber, inboundDbMessageEntry).then(() => {
          expectNthSlackMessageToChannel("north-carolina-0", 0, ["New North Carolina voter"]);
        });
    });

    test("Sends third voter to Slack channel for first pod in U.S. state, if only two pods exist", () => {
        redisClient.mgetAsync = jest.fn();
        redisClient.mgetAsync.mockResolvedValue(["2" /* num pods */, "2" /* num (previous) voters*/]);
        return determineVoterStateWrapper({
          userPhoneNumber: "+1234567890",
          userMessage: "NC",
          userInfo,
        }, redisClient, twilioPhoneNumber, inboundDbMessageEntry).then(() => {
          expectNthSlackMessageToChannel("north-carolina-0", 0, ["New North Carolina voter"]);
        });
    });

    test("Sends demo voters to Slack demo channel independent of normal channel number of voters and pods", () => {
        redisClient.mgetAsync = jest.fn().mockImplementation((numPodsKey, voterCounterKey) => {
          console.log(numPodsKey)
          console.log(voterCounterKey)
          if (numPodsKey == "numPodsNorthCarolina" && voterCounterKey == "voterCounterNorthCarolina") {
            // 0 pods, first real voter.
            return Promise.resolve(["1", "0"]);
          } else if (numPodsKey == "numPodsDemoNorthCarolina" && voterCounterKey == "voterCounterDemoNorthCarolina") {
            // 5 pods, 51st demo voter.
            return Promise.resolve(["5", "50"]);
          }
        });

        userInfo.isDemo = true;

        return determineVoterStateWrapper({
          userPhoneNumber: "+1234567890",
          userMessage: "NC",
          userInfo,
        }, redisClient, twilioPhoneNumber, inboundDbMessageEntry).then(() => {
          expectNthSlackMessageToChannel("demo-north-carolina-0", 0, ["New North Carolina voter"]);
        });
    });

    test("Sends old message history to Slack U.S. state channel thread", () => {
      return determineVoterStateWrapper({
        userPhoneNumber: "+1234567890",
        userMessage: "NC",
        userInfo,
      }, redisClient, twilioPhoneNumber, inboundDbMessageEntry).then(() => {
      // prepSuccessfullyDeterminedUsState().then(() => {
        // # of assertions = # of message parts + # of calls with parentMessageTs
        expect.assertions(2);
        expectNthSlackMessageToChannel("north-carolina-0", 1, ["can you help me vote"], null, true);
        expectNthSlackMessageToChannel("north-carolina-0", 2, ["Welcome to the Voter Help Line"], null, true);
      });
    });

    test("Copies U.S. state confirmation messages from lobby to Slack U.S. state channel thread", () => {
      return determineVoterStateWrapper({
        userPhoneNumber: "+1234567890",
        userMessage: "NC",
        userInfo,
      }, redisClient, twilioPhoneNumber, inboundDbMessageEntry).then(() => {
      // prepSuccessfullyDeterminedUsState().then(() => {
        // # of assertions = # of message parts + # of calls with parentMessageTs
        expect.assertions(4);
        expectNthSlackMessageToChannel("north-carolina-0", 3, ["NC"], "823487983742", true);
        expectNthSlackMessageToChannel("north-carolina-0", 4, ["We try to reply within minutes but may take up to 24 hours."], "823487983742", true);
      });
    });

    test("Updates redisClient Twilio-to-Slack lookup", () => {
      return determineVoterStateWrapper({
        userPhoneNumber: "+1234567890",
        userMessage: "NC",
        userInfo,
      }, redisClient, twilioPhoneNumber, inboundDbMessageEntry).then(() => {
      // prepSuccessfullyDeterminedUsState().then(() => {
        expect.assertions(2);
        const secsFromEpochNow = Math.round(Date.now() / 1000);
        for (call of RedisApiUtil.setHash.mock.calls) {
          const key = call[1];
          if (key == "+1234567890:+12054985052") {
            const value = call[2];
            expect(value).toEqual(expect.objectContaining({
              // Preserved:
              lobbyChannel: "#lobby",
              lobbyParentMessageTs: "293874928374",
              confirmedDisclaimer: false,
              isDemo: false,
              messageHistory: [
                "0923e: can you help me vote",
                "Welcome to the Voter Help Line! To match you with the most knowlegeable volunteer, in which U.S. state are you looking to vote? We currently service FL, NC and OH. (Msg & data rates may apply).",
              // Added:
                "0923e: NC",
                expect.stringMatching(/We try to reply within minutes but may take up to 24 hours./i),
              ],
              stateChannelChannel: "north-carolina-0",
              stateChannelParentMessageTs: "823487983742",
              stateName: "North Carolina",
            }));
            const lastVoterMessageSecsFromEpoch = value.lastVoterMessageSecsFromEpoch;
            expect(lastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(10);
          }
        }
      });
    });

    test("Adds redisClient Slack-to-Twilio lookup for the Slack U.S. state channel and thread", () => {
      return determineVoterStateWrapper({
        userPhoneNumber: "+1234567890",
        userMessage: "NC",
        userInfo,
      }, redisClient, twilioPhoneNumber, inboundDbMessageEntry).then(() => {
      // prepSuccessfullyDeterminedUsState().then(() => {
        expect.assertions(1);
        const secsFromEpochNow = Math.round(Date.now() / 1000);
        for (call of RedisApiUtil.setHash.mock.calls) {
          const key = call[1];
          if (key == "north-carolina-0:823487983742") {
            const value = call[2];
            expect(value).toEqual(expect.objectContaining({
              userPhoneNumber: "+1234567890",
              twilioPhoneNumber: "+12054985052",
            }));
          }
        }
      });
    });
  });
});

const handleDisclaimerWrapper = (userOptions, redisClient, twilioPhoneNumber, inboundDbMessageEntry) => {
  return new Promise((resolve, reject) => {
    resolve(RouterUtil.handleDisclaimer(userOptions, redisClient, twilioPhoneNumber, inboundDbMessageEntry));
  });
};

describe("handleDisclaimer", () => {
  beforeEach(() => {
    requireModules();
    SlackApiUtil.sendMessage.mockResolvedValue({
      data: {
        ts: "823487983742",
        channel: "#north-carolina"
      }
    });
  });

  describe("Runs regardless of whether voter is cleared", () => {
    beforeEach(() => {
      const userInfo = {
        lobbyChannel: "#lobby",
        lobbyParentMessageTs: "293874928374",
        confirmedDisclaimer: false,
        isDemo: false,
        messageHistory: [
          "can you help me vote",
          'Welcome to the Voter Help Line!',
        ],
        userId: "0923e",
      };

      const inboundDbMessageEntry = {
        mock: "inboundDbMessageEntryData",
      };

      const twilioPhoneNumber = "+12054985052";
      return handleDisclaimerWrapper({
        userPhoneNumber: "+1234567890",
        userMessage: "response to state question",
        userInfo,
      }, redisClient, twilioPhoneNumber, inboundDbMessageEntry);
    });

    test("Passes voter message to Slack lobby channel", () => {
      expect(SlackApiUtil.sendMessage.mock.calls[0][0]).toContain("response to state question");
      expect(SlackApiUtil.sendMessage.mock.calls[0][1]).toEqual(expect.objectContaining({
        parentMessageTs: "293874928374",
        channel: "#lobby",
      }));
    });

    test("Passes inbound database entry object to SlackApiUtil for logging", () => {
      expect(SlackApiUtil.sendMessage.mock.calls[0][2]).toEqual(expect.objectContaining({
        mock: "inboundDbMessageEntryData",
      }));
      // Ensure userInfo is passed to SlackApiUtil
      expect(SlackApiUtil.sendMessage.mock.calls[0][3]).not.toBeUndefined();
    });

    test("Includes updated lastVoterMessageSecsFromEpoch in inbound database entry object for logging", () => {
      const secsFromEpochNow = Math.round(Date.now() / 1000);
      const userInfo = SlackApiUtil.sendMessage.mock.calls[0][3];
      const newLastVoterMessageSecsFromEpoch = userInfo.lastVoterMessageSecsFromEpoch;
      expect(newLastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(10);
    });
  });

  describe("Voter is not cleared", () => {
    beforeEach(() => {
      const userInfo = {
        lobbyChannel: "#lobby",
        lobbyParentMessageTs: "293874928374",
        confirmedDisclaimer: false,
        isDemo: false,
        messageHistory: [
          "can you help me vote",
          "Welcome to the Voter Help Line!",
        ],
        userId: "0923e",
      };

      const inboundDbMessageEntry = {
        mock: "inboundDbMessageEntryData",
      };

      const twilioPhoneNumber = "+12054985052";
      return handleDisclaimerWrapper({
        userPhoneNumber: "+1234567890",
        userMessage: "i dont agree",
        userInfo,
      }, redisClient, twilioPhoneNumber, inboundDbMessageEntry)
    });

    test("Texts voter asking them again to agree to ToS disclaimer", () => {
      expect(TwilioApiUtil.sendMessage.mock.calls[0][0]).toEqual(expect.stringMatching(/to confirm that you understand/i));
      expect(TwilioApiUtil.sendMessage.mock.calls[0][1]).toEqual(expect.objectContaining({
        userPhoneNumber: "+1234567890",
        twilioPhoneNumber: "+12054985052",
      }));
    });

    test("Creates outbound database entry and passes to TwilioApiUtil for logging", () => {
      expect(TwilioApiUtil.sendMessage.mock.calls[0][2]).toEqual(expect.objectContaining({
        direction: "OUTBOUND",
        automated: true,
      }));
    });

    test("Includes updated lastVoterMessageSecsFromEpoch in outbound database entry object for logging", () => {
      const secsFromEpochNow = Math.round(Date.now() / 1000);
      const dbMessageEntry = TwilioApiUtil.sendMessage.mock.calls[0][2];
      const newLastVoterMessageSecsFromEpoch = dbMessageEntry.lastVoterMessageSecsFromEpoch;
      expect(newLastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(10);
    });

    test("Passes to Slack message asking voter again to agree to ToS disclaimer", () => {
      expect(SlackApiUtil.sendMessage.mock.calls[1][0]).toEqual(expect.stringMatching(/to confirm that you understand/i));
      expect(SlackApiUtil.sendMessage.mock.calls[1][1]).toEqual(expect.objectContaining({
        parentMessageTs: "293874928374",
        channel: "#lobby",
      }));
    });

    test("Preserves unchanged redisClient Twilio-to-Slack lookup data", () => {
      expect.assertions(1);
      const secsFromEpochNow = Math.round(Date.now() / 1000);
      for (call of RedisApiUtil.setHash.mock.calls) {
        const key = call[1];
        if (key == "+1234567890:+12054985052") {
          const value = call[2];
          expect(value).toEqual(expect.objectContaining({
            lobbyChannel: "#lobby",
            lobbyParentMessageTs: "293874928374",
            isDemo: false,
            messageHistory: expect.arrayContaining([
              "can you help me vote",
              "Welcome to the Voter Help Line!",
            ]),
          }));
        }
      }
    });

    test("Does not update redisClient Twilio-to-Slack lookup for confirmedDisclaimer, keeping it false", () => {
      expect.assertions(1);
      for (call of RedisApiUtil.setHash.mock.calls) {
        const key = call[1];
        if (key == "+1234567890:+12054985052") {
          const value = call[2];
          expect(value).toEqual(expect.objectContaining({
            confirmedDisclaimer: false,
          }));
        }
      }
    });

    test("Updates redisClient Twilio-to-Slack lookup with message history including new user message and automated response", () => {
      expect.assertions(1);
      const secsFromEpochNow = Math.round(Date.now() / 1000);
      for (call of RedisApiUtil.setHash.mock.calls) {
        const key = call[1];
        if (key == "+1234567890:+12054985052") {
          const value = call[2];
          expect(value).toEqual(expect.objectContaining({
            messageHistory: expect.arrayContaining([
              expect.stringMatching(/i dont agree/i),
              expect.stringMatching(/to confirm that you understand/i),
            ])
          }));
        }
      }
    });

    test("Updates redisClient Twilio-to-Slack lookup with lastVoterMessageSecsFromEpoch", () => {
      const secsFromEpochNow = Math.round(Date.now() / 1000);
      for (call of RedisApiUtil.setHash.mock.calls) {
        const key = call[1];
        if (key == "+1234567890:+12054985052") {
          const value = call[2];
          const lastVoterMessageSecsFromEpoch = value.lastVoterMessageSecsFromEpoch;
          expect(lastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(10);
        }
      }
    });
  });

  describe("Voter is cleared", () => {
    beforeEach(() => {
      const userInfo = {
        lobbyChannel: "#lobby",
        lobbyParentMessageTs: "293874928374",
        confirmedDisclaimer: false,
        isDemo: false,
        messageHistory: [
          "can you help me vote",
          "Welcome to the Voter Help Line!",
        ],
        userId: "0923e",
      };

      const inboundDbMessageEntry = {
        mock: "inboundDbMessageEntryData",
      };

      const twilioPhoneNumber = "+12054985052";
      return handleDisclaimerWrapper({
        userPhoneNumber: "+1234567890",
        userMessage: "agree",
        userInfo,
      }, redisClient, twilioPhoneNumber, inboundDbMessageEntry)
    });

    test("Texts voter confirming disclaimer agreement and asking for voter U.S. state", () => {
      expect(TwilioApiUtil.sendMessage.mock.calls[0][0]).toEqual(expect.stringMatching(/Great!.*in which U.S. state/i));
      expect(TwilioApiUtil.sendMessage.mock.calls[0][1]).toEqual(expect.objectContaining({
        userPhoneNumber: "+1234567890",
        twilioPhoneNumber: "+12054985052",
      }));
    });

    test("Creates outbound database entry and passes to TwilioApiUtil for logging", () => {
      expect(TwilioApiUtil.sendMessage.mock.calls[0][2]).toEqual(expect.objectContaining({
        direction: "OUTBOUND",
        automated: true,
      }));
    });

    test("Includes updated lastVoterMessageSecsFromEpoch in outbound database entry object for logging", () => {
      const secsFromEpochNow = Math.round(Date.now() / 1000);
      const dbMessageEntry = TwilioApiUtil.sendMessage.mock.calls[0][2];
      const newLastVoterMessageSecsFromEpoch = dbMessageEntry.lastVoterMessageSecsFromEpoch;
      expect(newLastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(10);
    });

    test("Passes to Slack message confirming disclaimer agreement and asking for voter U.S. state", () => {
      expect(SlackApiUtil.sendMessage.mock.calls[1][0]).toEqual(expect.stringMatching(/Great!.*in which U.S. state/i));
      expect(SlackApiUtil.sendMessage.mock.calls[1][1]).toEqual(expect.objectContaining({
        parentMessageTs: "293874928374",
        channel: "#lobby",
      }));
    });

    test("Preserves unchanged redisClient Twilio-to-Slack lookup data", () => {
      expect.assertions(1);
      const secsFromEpochNow = Math.round(Date.now() / 1000);
      for (call of RedisApiUtil.setHash.mock.calls) {
        const key = call[1];
        if (key == "+1234567890:+12054985052") {
          const value = call[2];
          expect(value).toEqual(expect.objectContaining({
            lobbyChannel: "#lobby",
            lobbyParentMessageTs: "293874928374",
            isDemo: false,
            messageHistory: expect.arrayContaining([
              "can you help me vote",
              "Welcome to the Voter Help Line!",
            ]),
          }));
        }
      }
    });

    test("Updates redisClient Twilio-to-Slack lookup with confirmedDisclaimer:true", () => {
      expect.assertions(1);
      const secsFromEpochNow = Math.round(Date.now() / 1000);
      for (call of RedisApiUtil.setHash.mock.calls) {
        const key = call[1];
        if (key == "+1234567890:+12054985052") {
          const value = call[2];
          expect(value).toEqual(expect.objectContaining({
            confirmedDisclaimer: true,
          }));
        }
      }
    });

    test("Updates redisClient Twilio-to-Slack lookup with message history including new user message and automated response", () => {
      expect.assertions(1);
      const secsFromEpochNow = Math.round(Date.now() / 1000);
      for (call of RedisApiUtil.setHash.mock.calls) {
        const key = call[1];
        if (key == "+1234567890:+12054985052") {
          const value = call[2];
          expect(value).toEqual(expect.objectContaining({
            messageHistory: expect.arrayContaining([
              expect.stringMatching(/agree/i),
              expect.stringMatching(/Great!.*in which U.S. state/i),
            ])
          }));
        }
      }
    });

    test("Updates redisClient Twilio-to-Slack lookup with lastVoterMessageSecsFromEpoch", () => {
      const secsFromEpochNow = Math.round(Date.now() / 1000);
      for (call of RedisApiUtil.setHash.mock.calls) {
        const key = call[1];
        if (key == "+1234567890:+12054985052") {
          const value = call[2];
          const lastVoterMessageSecsFromEpoch = value.lastVoterMessageSecsFromEpoch;
          expect(lastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(10);
        }
      }
    });
  });
});

const handleClearedVoterWrapper = (userOptions, redisClient, twilioPhoneNumber, inboundDbMessageEntry) => {
  return new Promise((resolve, reject) => {
    resolve(RouterUtil.handleClearedVoter(userOptions, redisClient, twilioPhoneNumber, inboundDbMessageEntry));
  });
};

describe("handleClearedVoter", () => {
  beforeEach(() => {
    requireModules();
    SlackApiUtil.sendMessage.mockResolvedValue({
      data: {
        ts: "823487983742",
        channel: "#north-carolina"
      }
    });
  });

  test("Passes voter message to Slack", () => {
    const userInfo = {
      stateChannelChannel: "north-carolina",
      stateChannelParentMessageTs: "823487983742",
      confirmedDisclaimer: true,
      isDemo: false,
      messageHistory: [],
      userId: "0923e",
    };

    const inboundDbMessageEntry = {
      mock: "inboundDbMessageEntryData",
    };

    const twilioPhoneNumber = "+12054985052";
    return handleClearedVoterWrapper({
      userPhoneNumber: "+1234567890",
      userMessage: "subsequent message",
      userInfo,
    }, redisClient, twilioPhoneNumber, inboundDbMessageEntry).then(() => {
      expect(SlackApiUtil.sendMessage.mock.calls[0][0]).toContain("subsequent message");
    });
  });

  test("Passes inbound database entry object to SlackApiUtil for logging", () => {
    const userInfo = {
      stateChannelChannel: "north-carolina",
      stateChannelParentMessageTs: "823487983742",
      confirmedDisclaimer: true,
      isDemo: false,
      messageHistory: [],
      userId: "0923e",
    };

    const inboundDbMessageEntry = {
      mock: "inboundDbMessageEntryData",
    };

    const twilioPhoneNumber = "+12054985052";
    return handleClearedVoterWrapper({
      userPhoneNumber: "+1234567890",
      userMessage: "subsequent message",
      userInfo,
    }, redisClient, twilioPhoneNumber, inboundDbMessageEntry).then(() => {
      expect(SlackApiUtil.sendMessage.mock.calls[0][2]).toEqual(expect.objectContaining({
        mock: "inboundDbMessageEntryData",
      }));
      expect(SlackApiUtil.sendMessage.mock.calls[0][3]).not.toBeUndefined();
    });
  });

  test("Includes updated lastVoterMessageSecsFromEpoch in inbound database entry object for logging", () => {
    const userInfo = {
      stateChannelChannel: "north-carolina",
      stateChannelParentMessageTs: "823487983742",
      confirmedDisclaimer: true,
      isDemo: false,
      messageHistory: [],
      userId: "0923e",
    };

    const inboundDbMessageEntry = {
      mock: "inboundDbMessageEntryData",
    };

    const twilioPhoneNumber = "+12054985052";
    return handleClearedVoterWrapper({
      userPhoneNumber: "+1234567890",
      userMessage: "subsequent message",
      userInfo,
    }, redisClient, twilioPhoneNumber, inboundDbMessageEntry).then(() => {
      const secsFromEpochNow = Math.round(Date.now() / 1000);
      const userInfo = SlackApiUtil.sendMessage.mock.calls[0][3];
      const newLastVoterMessageSecsFromEpoch = userInfo.lastVoterMessageSecsFromEpoch;
      expect(newLastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(10);
    });
  });

  test("Sends voter a welcome back text if it's been longer than 1 hour", () => {
    expect.assertions(2);
    const secsFromEpochNow = Math.round(Date.now() / 1000);
    const oneHourAndOneMinInSecs = (60 * 60) + 60;
    const mockLastVoterMessageSecsFromEpoch = Math.round((Date.now() / 1000) - oneHourAndOneMinInSecs);
    const userInfo = {
      stateChannelChannel: "north-carolina",
      stateChannelParentMessageTs: "823487983742",
      confirmedDisclaimer: true,
      isDemo: false,
      messageHistory: [],
      lastVoterMessageSecsFromEpoch: mockLastVoterMessageSecsFromEpoch,
      userId: "0923e",
    };

    const inboundDbMessageEntry = {
      mock: "inboundDbMessageEntryData",
    };

    const twilioPhoneNumber = "+12054985052";
    return handleClearedVoterWrapper({
      userPhoneNumber: "+1234567890",
      userMessage: "subsequent message",
      userInfo,
    }, redisClient, twilioPhoneNumber, inboundDbMessageEntry).then(() => {
      expect(TwilioApiUtil.sendMessage.mock.calls[0][0]).toEqual(expect.stringMatching(/Welcome back/i));
      expect(TwilioApiUtil.sendMessage.mock.calls[0][1]).toEqual(expect.objectContaining({
        userPhoneNumber: "+1234567890",
        twilioPhoneNumber: "+12054985052",
      }));
    });
  });

  test("Does not send an automated reply if last message is within 1 hour", () => {
    expect.assertions(1);
    const secsFromEpochNow = Math.round(Date.now() / 1000);
    const oneMinShyOfOneHourInSecs = (60 * 60) - 60;
    const mockLastVoterMessageSecsFromEpoch = Math.round((Date.now() / 1000) - oneMinShyOfOneHourInSecs);
    const userInfo = {
      stateChannelChannel: "north-carolina",
      stateChannelParentMessageTs: "823487983742",
      confirmedDisclaimer: true,
      isDemo: false,
      messageHistory: [],
      lastVoterMessageSecsFromEpoch: mockLastVoterMessageSecsFromEpoch,
      userId: "0923e",
    };

    const inboundDbMessageEntry = {
      mock: "inboundDbMessageEntryData",
    };

    const twilioPhoneNumber = "+12054985052";
    return handleClearedVoterWrapper({
      userPhoneNumber: "+1234567890",
      userMessage: "subsequent message",
      userInfo,
    }, redisClient, twilioPhoneNumber, inboundDbMessageEntry).then(() => {
      expect(TwilioApiUtil.sendMessage).not.toHaveBeenCalled();
    });
  });

  test("Updates redisClient Twilio-to-Slack lookup with lastVoterMessageSecsFromEpoch", () => {
    expect.assertions(1);
    const userInfo = {
      stateChannelChannel: "north-carolina",
      stateChannelParentMessageTs: "823487983742",
      confirmedDisclaimer: true,
      isDemo: false,
      messageHistory: [],
      userId: "0923e",
    };

    const inboundDbMessageEntry = {
      mock: "inboundDbMessageEntryData",
    };

    const twilioPhoneNumber = "+12054985052";
    return handleClearedVoterWrapper({
      userPhoneNumber: "+1234567890",
      userMessage: "subsequent message",
      userInfo,
    }, redisClient, twilioPhoneNumber, inboundDbMessageEntry).then(() => {
      const secsFromEpochNow = Math.round(Date.now() / 1000);
      for (call of RedisApiUtil.setHash.mock.calls) {
        const key = call[1];
        if (key == "+1234567890:+12054985052") {
          const value = call[2];
          const lastVoterMessageSecsFromEpoch = value.lastVoterMessageSecsFromEpoch;
          expect(lastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(10);
        }
      }
    });
  });
});
