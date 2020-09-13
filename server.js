if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
  require('dotenv').config();
}

const express = require('express');
const app = express();
const http = require('http').createServer(app);;
const redis = require('redis');
const bluebird = require('bluebird');
const SlackApiUtil = require('./slack_api_util');
const TwilioApiUtil = require('./twilio_api_util');
const Router = require('./router');
const Hashes = require('jshashes'); // v1.0.5
const bodyParser = require('body-parser');
const multer = require('multer'); // v1.0.5
const crypto = require('crypto');
const upload = multer(); // for parsing multipart/form-data
const MessagingResponse = require('twilio').twiml.MessagingResponse;
const { Client } = require('pg');
const DbApiUtil = require('./db_api_util');
const RedisApiUtil = require('./redis_api_util');
const LoadBalancer = require('./load_balancer');

app.use(bodyParser.urlencoded({ extended: false }));

app.use(bodyParser.json({
  verify: (req, res, buf) => {
    req.rawBody = buf
  }
}));

// Bluebird is supposed to create xxxAsync methods.
// https://github.com/NodeRedis/node_redis
bluebird.promisifyAll(redis);
var redisClient = redis.createClient(process.env.REDISCLOUD_URL);

const handleIncomingTwilioMessage = (req, entryPoint) => {
  console.log("\nEntering SERVER.handleIncomingTwilioMessage");
  const userPhoneNumber = req.body.From;
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
  }).catch(err => console.log(`SERVER.handleIncomingTwilioMessage (${userId}): ERROR looking up userInfo in Redis with redisHashKey ${redisHashKey}, error: ${err}`));
};

app.post('/push', (req, res) => {
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
      console.log(`Sending push message to phone number: ${userPhoneNumber}`)

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

  res.status(200);
});

app.post('/twilio-push', (req, res) => {
  console.log("\n\n**************************************************************************************************");
  console.log("******************************************************************************************************");
  console.log("Entering SERVER POST /twilio-push");
  const twiml = new MessagingResponse();
  handleIncomingTwilioMessage(req, LoadBalancer.PUSH_ENTRY_POINT);

  res.writeHead(200, {'Content-Type': 'text/xml'});
  res.end(twiml.toString());
});


app.post('/twilio-pull', (req, res) => {
  console.log("\n\n**************************************************************************************************");
  console.log("******************************************************************************************************");
  console.log("Entering SERVER POST /twilio-pull");
  const twiml = new MessagingResponse();
  handleIncomingTwilioMessage(req, LoadBalancer.PULL_ENTRY_POINT);

  res.writeHead(200, {'Content-Type': 'text/xml'});
  res.end(twiml.toString());
});

const passesAuth = (req) => {
  const requestTimestamp = req.header('X-Slack-Request-Timestamp');
  if (!requestTimestamp ||
         Math.abs((new Date().getTime() / 1000) - requestTimestamp) > 60 * 5) {
    console.log('Fails auth');
    return false;
  }

  const baseString = ['v0', requestTimestamp, req.rawBody].join(':');
  const slackSignature = 'v0=' + crypto
                                  .createHmac('sha256',
                                    process.env.SLACK_SIGNING_SECRET)
                                  .update(baseString, 'utf8')
                                  .digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(slackSignature, 'utf8'),
                 Buffer.from(req.header('X-Slack-Signature'), 'utf8'))) {
   console.log('Fails auth');
    return false;
  }

  return true;
}

const isRetry = (req) => {
  return "x-slack-retry-reason" in JSON.stringify(req.headers);
};

app.post('/slack', upload.array(), (req, res) => {
  console.log("\n\n**************************************************************************************************");
  console.log("******************************************************************************************************");
  console.log("Entering SERVER POST /slack");
  console.log(JSON.stringify(req.headers));
  res.type('application/json');

  if (!req.body.challenge) {
    const reqBody = req.body;
    if(process.env.NODE_ENV !== "development" && !passesAuth(req)) {
      console.log("SERVER POST /slack: ERROR in authenticating /slack request is from Slack.");
      res.sendStatus(401);
      return;
    }
    res.sendStatus(200);
    if (reqBody.event.type === "message"
        && reqBody.event.user != process.env.SLACK_BOT_USER_ID) {
      console.log(`SERVER POST /slack: Slack event listener caught non-bot Slack message from ${reqBody.event.user}.`);
      const redisHashKey = `${reqBody.event.channel}:${reqBody.event.thread_ts}`;

      // Pass Slack message to Twilio
      RedisApiUtil.getHash(redisClient, redisHashKey).then(redisData => {
        if (redisData != null) {
          console.log("SERVER POST /slack: Server received non-bot Slack message INSIDE a voter thread.");
          SlackApiUtil.fetchSlackUserName(reqBody.event.user).then(originatingSlackUserName => {
            console.log(`SERVER POST /slack: Successfully determined Slack user name of message sender: ${originatingSlackUserName}, from Slack user ID: ${reqBody.event.user}`);
            Router.handleSlackVoterThreadMessage(req, redisClient, redisData, originatingSlackUserName);
          }).catch(err => console.log(`SERVER POST /slack: ERROR determining Slack user name from Slack user ID`, err));
        } else {
          // Hash doesn't exist (this message is likely outside of a voter thread).
          console.log("SERVER POST /slack: Server received non-bot Slack message OUTSIDE a voter thread. Doing nothing.");
        }
      });
    } else if (reqBody.event.type === "app_mention"
                // Require that the Slack bot be the (first) user mentioned.
                && reqBody.authed_users[0] === process.env.SLACK_BOT_USER_ID
                // Require that the message was sent in the #admin-control-room Slack channel
                && reqBody.event.channel == process.env.ADMIN_CONTROL_ROOM_SLACK_CHANNEL_ID) {
      console.log("SERVER POST /slack: Slack event listener caught bot mention in admin channel.");
      SlackApiUtil.fetchSlackUserName(reqBody.event.user).then(originatingSlackUserName => {
        console.log(`SERVER POST /slack: Successfully determined Slack user name of bot mentioner: ${originatingSlackUserName}, from Slack user ID: ${reqBody.event.user}`);
        console.log(`SERVER POST /slack: Received admin control command from ${originatingSlackUserName}: ${reqBody.event.text}`);
        Router.handleSlackAdminCommand(reqBody, redisClient, originatingSlackUserName);
      });
    }
  } else {
    console.log("SERVER POST /slack: Authenticating Slack bot event listener with Node server.");
    // Authenticate Slack connection to Heroku.
    if (SlackApiUtil.authenticateConnectionToSlack(req.body.token)) {
      console.log("SERVER POST /slack: Slack-Node authentication successful.");
      res.status(200).json({ challenge: req.body.challenge });
    } else {
      res.status(401);
    }
  }
});

http.listen(process.env.PORT || 8080, function() {
  console.log('listening on *:8080');
});
