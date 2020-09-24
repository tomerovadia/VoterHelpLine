if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
  require('dotenv').config();
}

const express = require('express');
const app = express();
const http = require('http').createServer(app);;
const redis = require('redis');
const bluebird = require('bluebird');
const SlackApiUtil = require('./slack_api_util');
const SlackInteractionApiUtil = require('./slack_interaction_api_util');
const TwilioApiUtil = require('./twilio_api_util');
const Router = require('./router');
const Hashes = require('jshashes'); // v1.0.5
const bodyParser = require('body-parser');
// const multer = require('multer'); // v1.0.5
const contentType = require('content-type');
// const upload = multer(); // for parsing multipart/form-data
const MessagingResponse = require('twilio').twiml.MessagingResponse;
const { Client } = require('pg');
const DbApiUtil = require('./db_api_util');
const RedisApiUtil = require('./redis_api_util');
const LoadBalancer = require('./load_balancer');
const SlackUtil = require('./slack_util');
const TwilioUtil = require('./twilio_util');
const SlackInteractionHandler = require('./slack_interaction_handler');

const rawBodySaver = (req, res, buf, encoding) => {
  if (buf && buf.length) {
    req.rawBody = buf.toString(encoding || 'utf8');
  }
};

app.use(bodyParser.json({ verify: rawBodySaver }));
app.use(bodyParser.urlencoded({ verify: rawBodySaver, extended: false }));
app.use(bodyParser.raw({ verify: rawBodySaver, type: function () { return true } }));

// Bluebird is supposed to create xxxAsync methods.
// https://github.com/NodeRedis/node_redis
bluebird.promisifyAll(redis);
var redisClient = redis.createClient(process.env.REDISCLOUD_URL);

app.post('/push', (req, res) => {
  res.sendStatus(200);
  const TWILIO_PHONE_NUMBER = "+18557041009";
  const MESSAGE = "This is Voter Help Line! We sent you an absentee ballot request form. Did you receive it? Text STOP to stop messages. Msg & data rates may apply."

  const redisUserPhoneNumbersKey = "userPhoneNumbers";
  return redisClient.lrangeAsync(redisUserPhoneNumbersKey, 0, 1000).then((userPhoneNumbers, err) => {
    if (!userPhoneNumbers) {
      console.log(err);
      return;
    }
    console.log("userPhoneNumbers:");
    console.log(userPhoneNumbers);
    let delay = 0;
    let INTERVAL_MILLISECONDS = 2000;
    for (let idx in userPhoneNumbers) {
      const userPhoneNumber = userPhoneNumbers[idx];
      console.log(`Sending push message to phone number: ${userPhoneNumber}`);

      const MD5 = new Hashes.MD5;
      const userId = MD5.hex(userPhoneNumber);

      const dbMessageEntry = {
        direction: "OUTBOUND",
        automated: true,
        userId,
        entryPoint: LoadBalancer.PUSH_ENTRY_POINT,
      };
      setTimeout(TwilioApiUtil.sendMessage, delay, MESSAGE,
                  {twilioPhoneNumber: TWILIO_PHONE_NUMBER, userPhoneNumber},
                  dbMessageEntry);
      delay += INTERVAL_MILLISECONDS;
    }
  });
});

const handleIncomingTwilioMessage = (req, entryPoint) => {
  console.log("\nEntering SERVER.handleIncomingTwilioMessage");

  const userPhoneNumber = req.body.From;

  RedisApiUtil.getHashField(redisClient, "twilioBlockedUserPhoneNumbers", userPhoneNumber).then(isBlocked => {
    if (isBlocked === "1") {
      console.log(`SERVER POST /twilio-push: Received text from blocked phone number: ${userPhoneNumber}.`);
      return;
    }

    const twilioPhoneNumber = req.body.To;
    const userMessage = req.body.Body;
    const MD5 = new Hashes.MD5;
    const userId = MD5.hex(userPhoneNumber);
    console.log(`SERVER.handleIncomingTwilioMessage: Receiving Twilio message from ${entryPoint} entry point voter,
                  userPhoneNumber: ${userPhoneNumber},
                  twilioPhoneNumber: ${twilioPhoneNumber},
                  userMessage: ${userMessage},
                  userId: ${userId}`);

    const inboundDbMessageEntry = DbApiUtil.populateIncomingDbMessageTwilioEntry({
      userMessage,
      userPhoneNumber,
      twilioPhoneNumber,
      twilioMessageSid: req.body.SmsMessageSid,
      entryPoint: LoadBalancer.PUSH_ENTRY_POINT,
    });

    const redisHashKey = `${userId}:${twilioPhoneNumber}`;

    console.log(`SERVER.handleIncomingTwilioMessage (${userId}): Retrieving userInfo using redisHashKey: ${redisHashKey}`);

    RedisApiUtil.getHash(redisClient, redisHashKey).then(userInfo => {
      console.log(`SERVER.handleIncomingTwilioMessage (${userId}): Successfully received Redis response for userInfo retrieval with redisHashKey ${redisHashKey}, userInfo: ${JSON.stringify(userInfo)}`);
      // Seen this voter before
      if (userInfo != null) {
        console.log(`SERVER.handleIncomingTwilioMessage (${userId}): Voter is known to us (Redis returned userInfo for redisHashKey ${redisHashKey})`);
        // PUSH
        if (entryPoint === LoadBalancer.PUSH_ENTRY_POINT) {
          console.log(`SERVER.handleIncomingTwilioMessage (${userId}): Skipping automated system since entrypoint is ${LoadBalancer.PUSH_ENTRY_POINT}.`);
          // Don't do dislcaimer or U.S. state checks for push voters.
          Router.handleClearedVoter({userInfo, userPhoneNumber, userMessage}, redisClient, twilioPhoneNumber, inboundDbMessageEntry);
        // PULL
        } else if (userInfo.confirmedDisclaimer) {
          console.log(`SERVER.handleIncomingTwilioMessage (${userId}): Activating automated system since entrypoint is ${LoadBalancer.PULL_ENTRY_POINT}.`);
          console.log(`SERVER.handleIncomingTwilioMessage (${userId}): Voter has previously confirmed the disclaimer.`);
          // Voter has a state determined. The U.S. state name is used for
          // operator messages as well as to know whether a U.S. state is known
          // for the voter. This may not be ideal (create separate bool?).
          // If a volunteer has intervened, turn off automated replies.
          if (userInfo.stateName || userInfo.volunteerEngaged) {
            console.log(`SERVER.handleIncomingTwilioMessage (${userId}): Known U.S. state for voter (${userInfo.stateName}) or volunteer has engaged (${userInfo.volunteerEngaged}). Automated system no longer active.`);
            Router.handleClearedVoter({userInfo, userPhoneNumber, userMessage}, redisClient, twilioPhoneNumber, inboundDbMessageEntry);
          // Voter has no state determined
          } else {
            console.log(`SERVER.handleIncomingTwilioMessage (${userId}): U.S. state for voter is not known. Automated system will attempt to determine.`);
            Router.determineVoterState({userInfo, userPhoneNumber, userMessage}, redisClient, twilioPhoneNumber, inboundDbMessageEntry);
          }
        } else {
          console.log(`SERVER.handleIncomingTwilioMessage (${userId}): Activating automated system since entrypoint is ${LoadBalancer.PULL_ENTRY_POINT}`);
          console.log(`SERVER.handleIncomingTwilioMessage (${userId}): Voter has NOT previously confirmed the disclaimer. Automated system will attempt to confirm.`);
          Router.handleDisclaimer({userInfo, userPhoneNumber, userMessage}, redisClient, twilioPhoneNumber, inboundDbMessageEntry);
        }
      // Haven't seen this voter before
      } else {
        console.log(`SERVER.handleIncomingTwilioMessage (${userId}): Voter is new to us (Redis returned no userInfo for redisHashKey ${redisHashKey})`);
        Router.handleNewVoter({userPhoneNumber, userMessage, userId}, redisClient, twilioPhoneNumber, inboundDbMessageEntry, entryPoint);
      }
    }).catch(err => console.log('\x1b[41m%s\x1b[1m\x1b[0m', `SERVER.handleIncomingTwilioMessage (${userId}): ERROR looking up userInfo in Redis with redisHashKey ${redisHashKey}, error: ${err}`));
  });
};

app.post('/twilio-push', (req, res) => {
  console.log("\n\n**************************************************************************************************");
  console.log("******************************************************************************************************");
  console.log("Entering SERVER POST /twilio-push");
  const twiml = new MessagingResponse();

  if(TwilioUtil.passesAuth(req)) {
    console.log("SERVER.handleIncomingTwilioMessage: Passes Twilio auth.");
    handleIncomingTwilioMessage(req, LoadBalancer.PUSH_ENTRY_POINT)
    res.writeHead(200, {'Content-Type': 'text/xml'});
    res.end(twiml.toString());
  } else {
    console.log('\x1b[41m%s\x1b[1m\x1b[0m', "SERVER.handleIncomingTwilioMessage: ERROR authenticating /twilio-push request is from Twilio.");
    res.writeHead(401, {'Content-Type': 'text/xml'});
    res.end(twiml.toString());
  }
});


app.post('/twilio-pull', (req, res) => {
  console.log("\n\n**************************************************************************************************");
  console.log("******************************************************************************************************");
  console.log("Entering SERVER POST /twilio-pull");
  const twiml = new MessagingResponse();

  if(TwilioUtil.passesAuth(req)) {
    console.log("SERVER.handleIncomingTwilioMessage: Passes Twilio auth.");
    handleIncomingTwilioMessage(req, LoadBalancer.PULL_ENTRY_POINT)
    res.writeHead(200, {'Content-Type': 'text/xml'});
    res.end(twiml.toString());
  } else {
    console.log('\x1b[41m%s\x1b[1m\x1b[0m', "SERVER.handleIncomingTwilioMessage: ERROR authenticating /twilio-pull request is from Twilio.");
    res.writeHead(401, {'Content-Type': 'text/xml'});
    res.end(twiml.toString());
  }
});

const isRetry = (req) => {
  return "x-slack-retry-reason" in JSON.stringify(req.headers);
};

app.post('/slack', (req, res) => {
  console.log("\n\n**************************************************************************************************");
  console.log("******************************************************************************************************");
  console.log("Entering SERVER POST /slack");
  console.log(JSON.stringify(req.headers));
  res.type('application/json');

  if (!req.body.challenge) {
    if(!SlackUtil.passesAuth(req)) {
      console.log('\x1b[41m%s\x1b[1m\x1b[0m', "SERVER POST /slack: ERROR in authenticating /slack request is from Slack.");
      res.sendStatus(401);
      return;
    }
    res.sendStatus(200);

    const reqBody = req.body;
    if (!reqBody || !reqBody.event) {
      console.log('\x1b[41m%s\x1b[1m\x1b[0m', `SERVER POST /slack: Issue with Slack reqBody: ${reqBody}.`);
      return;
    }

    if (reqBody.event.type === "message"
        && reqBody.event.user != process.env.SLACK_BOT_USER_ID) {
      console.log(`SERVER POST /slack: Slack event listener caught non-bot Slack message from ${reqBody.event.user}.`);
      const redisHashKey = `${reqBody.event.channel}:${reqBody.event.thread_ts}`;

      // Pass Slack message to Twilio
      RedisApiUtil.getHash(redisClient, redisHashKey).then(redisData => {
        if (redisData != null) {
          console.log("SERVER POST /slack: Server received non-bot Slack message INSIDE a voter thread.");

          RedisApiUtil.getHashField(redisClient, "slackBlockedUserPhoneNumbers", redisData.userPhoneNumber).then(isBlocked => {
            if (isBlocked != "1") {
              SlackApiUtil.fetchSlackUserName(reqBody.event.user).then(originatingSlackUserName => {
                console.log(`SERVER POST /slack: Successfully determined Slack user name of message sender: ${originatingSlackUserName}, from Slack user ID: ${reqBody.event.user}`);
                Router.handleSlackVoterThreadMessage(req, redisClient, redisData, originatingSlackUserName);
              }).catch(err => console.log('\x1b[41m%s\x1b[1m\x1b[0m', `SERVER POST /slack: ERROR determining Slack user name from Slack user ID`, err));
            } else {
              console.log(`SERVER POST /slack: Received attempted Slack message to blocked phone number: ${redisData.userPhoneNumber}`);
              SlackApiUtil.sendMessage(`*Operator:* Your message was not relayed, as this phone number has been added to our blocklist.`,
                                            {channel: reqBody.event.channel, parentMessageTs: reqBody.event.thread_ts});
            }
          });
        } else {
          // Hash doesn't exist (this message is likely outside of a voter thread).
          console.log("SERVER POST /slack: Server received non-bot Slack message OUTSIDE a voter thread. Doing nothing.");
        }
      });
    } else if (reqBody.event.type === "app_mention"
                // Require that the Slack bot be the (first) user mentioned.
                && reqBody.authed_users[0] === process.env.SLACK_BOT_USER_ID) {
      SlackApiUtil.fetchSlackUserName(reqBody.event.user).then(originatingSlackUserName => {
        console.log(`SERVER POST /slack: Successfully determined Slack user name of bot mentioner: ${originatingSlackUserName}, from Slack user ID: ${reqBody.event.user}`);
        // For these commands, require that the message was sent in the #admin-control-room Slack channel.
        if (reqBody.event.channel === process.env.ADMIN_CONTROL_ROOM_SLACK_CHANNEL_ID) {
          console.log("SERVER POST /slack: Slack event listener caught bot mention in admin channel.");
          console.log(`SERVER POST /slack: Received admin control command from ${originatingSlackUserName}: ${reqBody.event.text}`);
          Router.handleSlackAdminCommand(reqBody, redisClient, originatingSlackUserName);
        }
      });
    }
  } else {
    console.log("SERVER POST /slack: Authenticating Slack bot event listener with Node server.");
    // Authenticate Slack connection to Heroku.
    if (SlackApiUtil.authenticateConnectionToSlack(req.body.token)) {
      console.log("SERVER POST /slack: Slack-Node authentication successful.");
      res.status(200).json({ challenge: req.body.challenge });
    } else {
      res.sendStatus(401);
    }
  }
});

app.post('/slack-interactivity', (req, res) => {
  console.log("\n\n**************************************************************************************************");
  console.log("******************************************************************************************************");
  console.log("Entering SERVER POST /slack-interactivity");
  res.type('application/json');

  if(!SlackUtil.passesAuth(req)) {
    console.log('\x1b[41m%s\x1b[1m\x1b[0m', "SERVER POST /slack-interactivity: ERROR in authenticating request is from Slack.");
    res.sendStatus(401);
    return;
  }
  console.log("SERVER POST /slack-interactivity: PASSES AUTH");

  // Sanity check
  if (!req.body || !req.body.payload) {
    console.log('\x1b[41m%s\x1b[1m\x1b[0m', "SERVER POST /slack-interactivity: ERROR with req.body or req.body.payload.");
    return;
  }

  const payload = JSON.parse(req.body.payload);

  SlackApiUtil.fetchSlackUserName(payload.user.id).then(originatingSlackUserName => {
    SlackApiUtil.fetchSlackChannelName(payload.channel.id).then(originatingSlackChannelName => {
      const redisHashKey = `${payload.channel.id}:${payload.container.thread_ts}`;
      RedisApiUtil.getHash(redisClient, redisHashKey).then(redisData => {
        const selectedVoterStatus = payload.actions[0].selected_option ? payload.actions[0].selected_option.value : payload.actions[0].value;
        if (selectedVoterStatus) {
          console.log(`SERVER POST /slack-interactivity: Determined user interaction is a voter status update or undo.`);
          SlackInteractionHandler.handleVoterStatusUpdate({payload,
                                                             res,
                                                             selectedVoterStatus,
                                                             originatingSlackUserName,
                                                             originatingSlackChannelName,
                                                             userPhoneNumber: redisData.userPhoneNumber,
                                                             twilioPhoneNumber: redisData.twilioPhoneNumber,
                                                             redisClient});
        } else if (payload.actions[0].selected_user) {
          console.log(`SERVER POST /slack-interactivity: Determined user interaction is a volunteer update.`);
          SlackInteractionHandler.handleVolunteerUpdate({payload,
                                                           res,
                                                           originatingSlackUserName,
                                                           originatingSlackChannelName,
                                                           userPhoneNumber: redisData.userPhoneNumber,
                                                           twilioPhoneNumber: redisData.twilioPhoneNumber});
        }
      }).catch(err => {
        console.log('\x1b[41m%s\x1b[1m\x1b[0m', `SERVER POST /slack-interactivity: ERROR fetching Redis data: ${err}`);
        res.sendStatus(500);
      });
    }).catch(err => {
      console.log('\x1b[41m%s\x1b[1m\x1b[0m', `SERVER POST /slack-interactivity: ERROR fetching Slack channel name: ${err}`);
      res.sendStatus(500);
    });
  }).catch(err => {
    console.log('\x1b[41m%s\x1b[1m\x1b[0m', `SERVER POST /slack-interactivity: ERROR fetching Slack user name: ${err}`);
    res.sendStatus(500);
  });
});

http.listen(process.env.PORT || 8080, function() {
  console.log('listening on *:8080');
});
