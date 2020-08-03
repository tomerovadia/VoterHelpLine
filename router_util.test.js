const requireModules = () => {
  RouterUtil = require('./router_util');
  MessageParserUtil = require('./message_parser_util');
  TwilioApiUtil = require('./twilio_api_util');
  SlackApiUtil = require('./slack_api_util');
  redis = require("redis-mock"), redisClient = redis.createClient();

  jest.mock('./twilio_api_util');
  // jest.mock('./slack_api_util');
  jest.mock('./message_parser_util');

  SlackApiUtil.sendMessage = jest.fn();
  redisClient.setAsync = jest.fn();
};

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

const handleNewVoterWrapper = (userOptions, redisClient, twilioPhoneNumber) => {
  return new Promise((resolve, reject) => {
    resolve(RouterUtil.handleNewVoter(userOptions, redisClient, twilioPhoneNumber));
  });
}

describe('handleNewVoter', () => {
  beforeEach(() => {
    requireModules();
    SlackApiUtil.sendMessage.mockResolvedValue({
      data: {
        ts: "293874928374",
        channel: "#lobby"
      }
    });

    return handleNewVoterWrapper({
      userPhoneNumber: "+1234567890",
      userId: "abcdefghijklmnop",
      userMessage: "can you help me vote",
    }, redisClient, "+12054985052");
  });

  test("Announces new voter message in Slack", () => {
    expect(SlackApiUtil.sendMessage.mock.calls[0][0]).toContain("New voter");
  });

  test("Announces new voter message to Slack #lobby channel if non-demo line", () => {
    expect(SlackApiUtil.sendMessage.mock.calls[0][1].channel).toBe("#lobby");
  });

  test("Announces new voter message to Slack #demo-lobby channel if demo line", () => {
    jest.clearAllMocks();
    return handleNewVoterWrapper({
      userPhoneNumber: "+1234567890",
      userId: "abcdefghijklmnop",
      userMessage: "can you help me vote",
    }, redisClient, "+19842318683").then(() => {
      expect(SlackApiUtil.sendMessage.mock.calls[0][1].channel).toBe("#demo-lobby");
    });
  });

  test("Includes user id in new voter announcement in Slack", () => {
    expect(SlackApiUtil.sendMessage.mock.calls[0][0]).toContain("abcdefghijklmnop");
  });

  test("Relays voter message in subsequent message to Slack", () => {
    expect(SlackApiUtil.sendMessage.mock.calls[1][0]).toEqual(expect.stringContaining("can you help me vote"));
  });

  test("Includes voter id in relay of voter message", () => {
    expect(SlackApiUtil.sendMessage.mock.calls[1][0]).toEqual(expect.stringContaining("abcdefghijklmnop"));
  });

  test("Relays automated welcoming of voter to Slack", () => {
    expect(SlackApiUtil.sendMessage.mock.calls[2][0]).toEqual(expect.stringContaining("Welcome"));
  });

  test("Sends one response to the user", () => {
    expect(TwilioApiUtil.sendMessage).toHaveBeenCalledTimes(1);
  });

  test("Sends one response to the user with welcome", () => {
    expect(TwilioApiUtil.sendMessage.mock.calls[0][0]).toEqual(expect.stringMatching(/welcome/i));
  });

  test("Adds two keys to redisClient", () => {
    expect(redisClient.setAsync).toHaveBeenCalledTimes(2);
  });

  test("Adds redisClient Twilio-to-Slack lookup", () => {
    expect(redisClient.setAsync.mock.calls).toEqual(expect.arrayContaining([expect.arrayContaining(["+1234567890"])]));
  });

  test("Adds redisClient Twilio-to-Slack lookup with Slack channel", () => {
    expect.assertions(1);
    for (call of redisClient.setAsync.mock.calls) {
      const key = call[0];
      if (key == "+1234567890") {
        const value = call[1];
        expect(JSON.parse(value).lobby).toEqual(expect.objectContaining({channel: "#lobby"}));
      }
    }
  });

  test("Adds redisClient Twilio-to-Slack lookup with Slack thread", () => {
    expect.assertions(1);
    for (call of redisClient.setAsync.mock.calls) {
      const key = call[0];
      if (key == "+1234567890") {
        const value = call[1];
        expect(JSON.parse(value).lobby).toEqual(expect.objectContaining({parentMessageTs: "293874928374"}));
      }
    }
  });

  test("Adds redisClient Twilio-to-Slack lookup with isDemo:true for demo line", () => {
    expect.assertions(1);
    jest.clearAllMocks();
    return handleNewVoterWrapper({
      userPhoneNumber: "+1234567890",
      userId: "abcdefghijklmnop",
      userMessage: "can you help me vote",
    }, redisClient, "+19842318683").then(() => {
      for (call of redisClient.setAsync.mock.calls) {
        const key = call[0];
        if (key == "+1234567890") {
          const value = call[1];
          expect(JSON.parse(value)).toEqual(expect.objectContaining({isDemo: true}));
        }
      }
    });
  });

  test("Adds redisClient Twilio-to-Slack lookup with isDemo:false for non-demo line", () => {
    expect.assertions(1);
    for (call of redisClient.setAsync.mock.calls) {
      const key = call[0];
      if (key == "+1234567890") {
        const value = call[1];
        expect(JSON.parse(value)).toEqual(expect.objectContaining({isDemo: false}));
      }
    }
  });

  test("Adds redisClient Twilio-to-Slack lookup with confirmedDisclaimer:false", () => {
    expect.assertions(1);
    for (call of redisClient.setAsync.mock.calls) {
      const key = call[0];
      if (key == "+1234567890") {
        const value = call[1];
        expect(JSON.parse(value)).toEqual(expect.objectContaining({confirmedDisclaimer: false}));
      }
    }
  });

  test("Adds redisClient Twilio-to-Slack lookup with messageHistory", () => {
    expect.assertions(1);
    for (call of redisClient.setAsync.mock.calls) {
      const key = call[0];
      if (key == "+1234567890") {
        const value = call[1];
        expect(JSON.parse(value)).toEqual(expect.objectContaining({messageHistory: expect.arrayContaining([
          expect.stringContaining("can you help me vote"),
          expect.stringContaining("Welcome"),
        ])}));
      }
    }
  });

  test("Adds redisClient Twilio-to-Slack lookup with lastVoterMessageSecsFromEpoch", () => {
    expect.assertions(1);
    const secsFromEpochNow = Math.round(Date.now() / 1000);
    for (call of redisClient.setAsync.mock.calls) {
      const key = call[0];
      if (key == "+1234567890") {
        const value = call[1];
        const lastVoterMessageSecsFromEpoch = JSON.parse(value).lastVoterMessageSecsFromEpoch;
        expect(lastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(10);
      }
    }
  });

  test("Adds redisClient Slack-to-Twilio lookup", () => {
      expect(redisClient.setAsync.mock.calls).toEqual(expect.arrayContaining([expect.arrayContaining(["#lobby:293874928374"])]));
  });

  test("Adds redisClient Slack-to-Twilio lookup with user phone number", () => {
    expect.assertions(1);
      for (call of redisClient.setAsync.mock.calls) {
        const key = call[0];
        if (key == "#lobby:293874928374") {
          const value = call[1];
          expect(JSON.parse(value)).toEqual(expect.objectContaining({userPhoneNumber: "+1234567890"}));
        }
      }
  });

  test("Adds redisClient Slack-to-Twilio lookup with Twilio phone number", () => {
    for (call of redisClient.setAsync.mock.calls) {
      const key = call[0];
      if (key == "#lobby:293874928374") {
        const value = call[1];
        expect(JSON.parse(value)).toEqual(expect.objectContaining({twilioPhoneNumber: "+12054985052"}));
      }
    }
  });
});

const determineVoterStateWrapper = (userOptions, redisClient, twilioPhoneNumber) => {
  return new Promise((resolve, reject) => {
    resolve(RouterUtil.determineVoterState(userOptions, redisClient, twilioPhoneNumber));
  });
};

// const introduceVoterToStateChannelWrapper = (userOptions, redisClient, twilioPhoneNumber) => {
//   return new Promise((resolve, reject) => {
//     RouterUtil.introduceVoterToStateChannel(userOptions, redisClient, twilioPhoneNumber);
//     resolve(null);
//   });
// };

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
      return determineVoterStateWrapper({
        userPhoneNumber: "+1234567890",
        userId: "abcdefghijklmnop",
        userMessage: "nonsensical statement",
        userInfo: {
          lobby: {
            channel: "#lobby",
            parentMessageTs: "293874928374",
          },
          confirmedDisclaimer: false,
          isDemo: false,
          messageHistory: [
            "can you help me vote",
            "Welcome to the Voter Help Line! We are finding an available volunteer -- in the meantime, please tell us more about how we can help you vote. Please note that we currently only service North Carolina. (Msg & data rates may apply)."
          ],
        },
      }, redisClient, "+12054985052");
    });
    test("Passes voter message to Slack", () => {
      expect(SlackApiUtil.sendMessage.mock.calls[0][0]).toContain("nonsensical statement");
    });

    test("Includes voter user id in passing voter message to Slack", () => {
      expect(SlackApiUtil.sendMessage.mock.calls[0][0]).toContain("abcdefghijklmnop");
    });

    test("Sends voter message to voter's channel/thread in Slack lobby", () => {
      expect(SlackApiUtil.sendMessage.mock.calls[0][1]).toEqual(expect.objectContaining({
        parentMessageTs: "293874928374",
        channel: "#lobby",
      }));
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
      return determineVoterStateWrapper({
        userPhoneNumber: "+1234567890",
        userId: "abcdefghijklmnop",
        userMessage: "nonsensical statement",
        userInfo: {
          lobby: {
            channel: "#lobby",
            parentMessageTs: "293874928374",
          },
          confirmedDisclaimer: false,
          isDemo: false,
          messageHistory: [
            "can you help me vote",
            "Welcome to the Voter Help Line! We are finding an available volunteer -- in the meantime, please tell us more about how we can help you vote. Please note that we currently only service North Carolina. (Msg & data rates may apply)."
          ],
        },
      }, redisClient, "+12054985052");
    });

    test("Sends a message to voter clarifying if U.S. state wasn't recognized", () => {
      expect(TwilioApiUtil.sendMessage.mock.calls[0][0]).toContain("didn't understand");
      expect(TwilioApiUtil.sendMessage.mock.calls[0][1]).toEqual(expect.objectContaining({
        userPhoneNumber: "+1234567890",
        twilioPhoneNumber: "+12054985052",
      }));
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
      for (call of redisClient.setAsync.mock.calls) {
        const key = call[0];
        if (key == "+1234567890") {
          const value = call[1];
          const lastVoterMessageSecsFromEpoch = JSON.parse(value).lastVoterMessageSecsFromEpoch;
          expect(lastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(10);
        }
      }
    });

    test("Adds new messages to redisClient Twilio-to-Slack lookup messageHistory", () => {
      expect.assertions(1);
      for (call of redisClient.setAsync.mock.calls) {
        const key = call[0];
        if (key == "+1234567890") {
          const value = call[1];
          expect(JSON.parse(value)).toEqual(expect.objectContaining({messageHistory: expect.arrayContaining([
            expect.stringContaining("nonsensical statement"),
            expect.stringContaining("didn't understand"),
          ])}));
        }
      }
    });

    test("Keeps old messages in redisClient Twilio-to-Slack lookup messageHistory", () => {
      expect.assertions(1);
      for (call of redisClient.setAsync.mock.calls) {
        const key = call[0];
        if (key == "+1234567890") {
          const value = call[1];
          expect(JSON.parse(value)).toEqual(expect.objectContaining({messageHistory: expect.arrayContaining([
            expect.stringContaining("can you help me vote"),
            expect.stringContaining("Welcome to the Voter Help Line! We are finding an available volunteer -- in the meantime, please tell us more about how we can help you vote. Please note that we currently only service North Carolina. (Msg & data rates may apply)."),
          ])}));
        }
      }
    });
  });

  describe("Successfully determined voter U.S. state", () => {
    beforeEach(() => {
      MessageParserUtil.determineState.mockReturnValue("North Carolina");

      const lobbySlackMessageResponse = {
        data: {
          ts: "293874928374",
          channel: "#lobby"
        }
      };

      const stateSlackMessageResponse = {
        data: {
          ts: "823487983742",
          channel: "#north-carolina"
        }
      };

      // This default response will kick in once the mockResolvedValueOnce calls run out.
      SlackApiUtil.sendMessage.mockResolvedValue(lobbySlackMessageResponse);

      // This is a bit hacky. Because the calls are async, the messages send
      // simultaneously to lobby and state channels. Second message sent happens
      // to be to state channel (which sort of makes sense when you think about it).
      SlackApiUtil.sendMessage.mockResolvedValueOnce(lobbySlackMessageResponse).mockResolvedValueOnce(stateSlackMessageResponse);

      const userInfo = {
        lobby: {
          channel: "#lobby",
          parentMessageTs: "293874928374",
        },
        confirmedDisclaimer: false,
        isDemo: false,
        messageHistory: [
          "abcdefghijklmnop: can you help me vote",
          "Welcome to the Voter Help Line! To match you with the most knowlegeable volunteer, in which U.S. state are you looking to vote? We currently service FL, NC and OH. (Msg & data rates may apply).",
        ],
      };

      const twilioPhoneNumber = "+12054985052";
      return determineVoterStateWrapper({
        userPhoneNumber: "+1234567890",
        userId: "abcdefghijklmnop",
        userMessage: "NC",
        userInfo,
      }, redisClient, twilioPhoneNumber);
    });

    test("Sends ToS disclaimer message to voter", () => {
      expect(TwilioApiUtil.sendMessage.mock.calls[0][0]).toContain("you release Voter Help Line of all liability");
      expect(TwilioApiUtil.sendMessage.mock.calls[0][1]).toEqual(expect.objectContaining({
        userPhoneNumber: "+1234567890",
        twilioPhoneNumber: "+12054985052",
      }));
    });

    test("Sends copy of ToS disclaimer message to Slack lobby", () => {
      expectNthSlackMessageToChannel("#lobby", 1, ["you release Voter Help Line of all liability"], "293874928374");
    });

    test("Sends operator message to lobby announcing voter is being routed", () => {
      expectNthSlackMessageToChannel("#lobby", 2, ["Routing voter"], "293874928374");
    });

    test("Sends first Slack message to U.S. state channel announcing voter with userId", () => {
      expectNthSlackMessageToChannel("north-carolina", 0, ["New North Carolina voter", "abcdefghijklmnop"]);
    });

    test("Sends old message history to Slack U.S. state channel thread", () => {
      // # of assertions = # of message parts + # of calls with parentMessageTs
      expect.assertions(2);
      expectNthSlackMessageToChannel("north-carolina", 1, ["can you help me vote"], null, true);
      expectNthSlackMessageToChannel("north-carolina", 2, ["Welcome to the Voter Help Line"], null, true);
    });

    test("Copies U.S. state confirmation messages from lobby to Slack U.S. state channel thread", () => {
      // # of assertions = # of message parts + # of calls with parentMessageTs
      expect.assertions(4);
      expectNthSlackMessageToChannel("north-carolina", 3, ["NC"], "823487983742", true);
      expectNthSlackMessageToChannel("north-carolina", 4, ["you release Voter Help Line of all liability"], "823487983742", true);
    });

    test("Updates redisClient Twilio-to-Slack lookup", () => {
      expect.assertions(2);
      const secsFromEpochNow = Math.round(Date.now() / 1000);
      for (call of redisClient.setAsync.mock.calls) {
        const key = call[0];
        if (key == "+1234567890") {
          const value = call[1];
          expect(JSON.parse(value)).toEqual(expect.objectContaining({
            // Preserved:
            lobby: {
              channel: "#lobby",
              parentMessageTs: "293874928374",
            },
            confirmedDisclaimer: false,
            isDemo: false,
            messageHistory: [
              "abcdefghijklmnop: can you help me vote",
              "Welcome to the Voter Help Line! To match you with the most knowlegeable volunteer, in which U.S. state are you looking to vote? We currently service FL, NC and OH. (Msg & data rates may apply).",
            // Added:
              "abcdefghijklmnop: NC",
              expect.stringMatching(/you release Voter Help Line of all liability/i),
            ],
            stateChannel: {
              channel: "north-carolina",
              parentMessageTs: "823487983742",
            },
            stateName: "North Carolina",
          }));
          const lastVoterMessageSecsFromEpoch = JSON.parse(value).lastVoterMessageSecsFromEpoch;
          expect(lastVoterMessageSecsFromEpoch - secsFromEpochNow).toBeLessThan(10);
        }
      }
    });

    test("Adds redisClient Slack-to-Twilio lookup for the Slack U.S. state channel and thread", () => {
      expect.assertions(1);
      const secsFromEpochNow = Math.round(Date.now() / 1000);
      for (call of redisClient.setAsync.mock.calls) {
        const key = call[0];
        if (key == "#north-carolina:823487983742") {
          const value = call[1];
          expect(JSON.parse(value)).toEqual(expect.objectContaining({userPhoneNumber: "+1234567890"}));
        }
      }
    });
  });
});

const handleDisclaimerWrapper = (userOptions, redisClient, twilioPhoneNumber) => {
  return new Promise((resolve, reject) => {
    resolve(RouterUtil.handleDisclaimer(userOptions, redisClient, twilioPhoneNumber));
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
        lobby: {
          channel: "#lobby",
          parentMessageTs: "293874928374",
        },
        stateChannel: {
          channel: "north-carolina",
          parentMessageTs: "823487983742",
        },
        confirmedDisclaimer: false,
        isDemo: false,
        messageHistory: [
          "abcdefghijklmnop: can you help me vote",
          "Welcome to the Voter Help Line! To match you with the most knowlegeable volunteer, in which U.S. state are you looking to vote? We currently service FL, NC and OH. (Msg & data rates may apply).",
          "abcdefghijklmnop: NC",
          "you release Voter Help Line of all liability"
        ],
        stateName: "North Carolina",
      };

      const twilioPhoneNumber = "+12054985052";
      return handleDisclaimerWrapper({
        userPhoneNumber: "+1234567890",
        userId: "abcdefghijklmnop",
        userMessage: "subsequent message",
        userInfo,
      }, redisClient, twilioPhoneNumber);
    });

    test("Passes voter message to Slack channel corresponding to voter U.S. state", () => {
      expect(SlackApiUtil.sendMessage.mock.calls[0][0]).toContain("subsequent message");
      expect(SlackApiUtil.sendMessage.mock.calls[0][1]).toEqual(expect.objectContaining({
        parentMessageTs: "823487983742",
        channel: "north-carolina",
      }));
    });
  });

  describe("Voter is not cleared", () => {
    beforeEach(() => {
      const userInfo = {
        stateChannel: {
          channel: "north-carolina",
          parentMessageTs: "823487983742",
        },
        confirmedDisclaimer: false,
        isDemo: false,
        messageHistory: [],
      };

      const twilioPhoneNumber = "+12054985052";
      return handleDisclaimerWrapper({
        userPhoneNumber: "+1234567890",
        userId: "abcdefghijklmnop",
        userMessage: "i dont agree",
        userInfo,
      }, redisClient, twilioPhoneNumber)
    });

    test("Texts voter asking them again to agree to ToS disclaimer", () => {
      expect(TwilioApiUtil.sendMessage.mock.calls[0][0]).toEqual(expect.stringMatching(/Please reply “agree” to confirm that you understand and would like to continue/i));
      expect(TwilioApiUtil.sendMessage.mock.calls[0][1]).toEqual(expect.objectContaining({
        userPhoneNumber: "+1234567890",
        twilioPhoneNumber: "+12054985052",
      }));
    });

    test("Passes to Slack message asking voter again to agree to ToS disclaimer", () => {
      expect(SlackApiUtil.sendMessage.mock.calls[1][0]).toEqual(expect.stringMatching(/Please reply “agree” to confirm that you understand and would like to continue/i));
      expect(SlackApiUtil.sendMessage.mock.calls[1][1]).toEqual(expect.objectContaining({
        parentMessageTs: "823487983742",
        channel: "north-carolina",
      }));
    });
  });

  describe("Voter is cleared", () => {
    beforeEach(() => {
      const userInfo = {
        stateChannel: {
          channel: "north-carolina",
          parentMessageTs: "823487983742",
        },
        confirmedDisclaimer: false,
        isDemo: false,
        messageHistory: [],
      };

      const twilioPhoneNumber = "+12054985052";
      return handleDisclaimerWrapper({
        userPhoneNumber: "+1234567890",
        userId: "abcdefghijklmnop",
        userMessage: "agree",
        userInfo,
      }, redisClient, twilioPhoneNumber)
    });

    test("Texts voter confirming disclaimer agreement and informing of retrieving volunteer", () => {
      expect(TwilioApiUtil.sendMessage.mock.calls[0][0]).toEqual(expect.stringMatching(/Great! We are finding a volunteer. We try to reply within minutes but may take up to 24 hours./i));
      expect(TwilioApiUtil.sendMessage.mock.calls[0][1]).toEqual(expect.objectContaining({
        userPhoneNumber: "+1234567890",
        twilioPhoneNumber: "+12054985052",
      }));
    });

    test("Passes to Slack message confirming disclaimer agreement and informing of retrieving volunteer", () => {
      expect(SlackApiUtil.sendMessage.mock.calls[1][0]).toEqual(expect.stringMatching(/Great! We are finding a volunteer. We try to reply within minutes but may take up to 24 hours./i));
      expect(SlackApiUtil.sendMessage.mock.calls[1][1]).toEqual(expect.objectContaining({
        parentMessageTs: "823487983742",
        channel: "north-carolina",
      }));
    });

    test("Updates redisClient Twilio-to-Slack lookup with confirmedDisclaimer:true", () => {
      expect.assertions(1);
      const secsFromEpochNow = Math.round(Date.now() / 1000);
      for (call of redisClient.setAsync.mock.calls) {
        const key = call[0];
        if (key == "+1234567890") {
          const value = call[1];
          expect(JSON.parse(value)).toEqual(expect.objectContaining({
            stateChannel: {
              channel: "north-carolina",
              parentMessageTs: "823487983742",
            },
            confirmedDisclaimer: true,
            isDemo: false,
            messageHistory: [],
          }));
        }
      }
    });
  });
});

const handleClearedVoterWrapper = (userOptions, redisClient, twilioPhoneNumber) => {
  return new Promise((resolve, reject) => {
    resolve(RouterUtil.handleClearedVoter(userOptions, redisClient, twilioPhoneNumber));
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
      stateChannel: {
        channel: "north-carolina",
        parentMessageTs: "823487983742",
      },
      confirmedDisclaimer: true,
      isDemo: false,
      messageHistory: [],
    };

    const twilioPhoneNumber = "+12054985052";
    return handleClearedVoterWrapper({
      userPhoneNumber: "+1234567890",
      userId: "abcdefghijklmnop",
      userMessage: "subsequent message",
      userInfo,
    }, redisClient, twilioPhoneNumber).then(() => {
      expect(SlackApiUtil.sendMessage.mock.calls[0][0]).toContain("subsequent message");
    });
  });

  test("Sends voter a welcome back text if it's been longer than 1 hour", () => {
    expect.assertions(2);
    const secsFromEpochNow = Math.round(Date.now() / 1000);
    const oneHourAndOneMinInSecs = (60 * 60) + 60;
    const mockLastVoterMessageSecsFromEpoch = Math.round((Date.now() / 1000) - oneHourAndOneMinInSecs);
    const userInfo = {
      stateChannel: {
        channel: "north-carolina",
        parentMessageTs: "823487983742",
      },
      confirmedDisclaimer: true,
      isDemo: false,
      messageHistory: [],
      lastVoterMessageSecsFromEpoch: mockLastVoterMessageSecsFromEpoch,
    };

    const twilioPhoneNumber = "+12054985052";
    return handleClearedVoterWrapper({
      userPhoneNumber: "+1234567890",
      userId: "abcdefghijklmnop",
      userMessage: "subsequent message",
      userInfo,
    }, redisClient, twilioPhoneNumber).then(() => {
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
      stateChannel: {
        channel: "north-carolina",
        parentMessageTs: "823487983742",
      },
      confirmedDisclaimer: true,
      isDemo: false,
      messageHistory: [],
      lastVoterMessageSecsFromEpoch: mockLastVoterMessageSecsFromEpoch,
    };

    const twilioPhoneNumber = "+12054985052";
    return handleClearedVoterWrapper({
      userPhoneNumber: "+1234567890",
      userId: "abcdefghijklmnop",
      userMessage: "subsequent message",
      userInfo,
    }, redisClient, twilioPhoneNumber).then(() => {
      expect(TwilioApiUtil.sendMessage).not.toHaveBeenCalled();
    });
  });
});