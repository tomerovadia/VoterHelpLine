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
  console.log(`Receiving Twilio message from ${entryPoint} entry point voter.`);
  const userPhoneNumber = req.body.From;
  const twilioPhoneNumber = req.body.To;
  const userMessage = req.body.Body;
  const MD5 = new Hashes.MD5;
  const userId = MD5.hex(userPhoneNumber);

  const inboundDbMessageEntry = DbApiUtil.populateIncomingDbMessageTwilioEntry({
    userMessage,
    userPhoneNumber,
    twilioPhoneNumber,
    twilioMessageSid: req.body.SmsMessageSid,
    // ADD ENTRY_POINT
  });

  const redisHashKey = `${userId}:${twilioPhoneNumber}`;

  RedisApiUtil.getHash(redisClient, redisHashKey).then(userInfo => {
    // Seen this voter before
    if (userInfo != null) {
      // PUSH
      if (entryPoint === LoadBalancer.PUSH_ENTRY_POINT) {
        console.log("Server: handleClearedVoter");
        // Don't do dislcaimer or U.S. state checks for push voters.
        Router.handleClearedVoter({userInfo, userPhoneNumber, userMessage}, redisClient, twilioPhoneNumber, inboundDbMessageEntry);
      // PULL
      } else if (userInfo.confirmedDisclaimer) {
        // Voter has a state determined. The U.S. state name is used for
        // operator messages as well as to know whether a U.S. state is known
        // for the voter. This may not be ideal (create separate bool?).
        // If a volunteer has intervened, turn off automated replies.
        if (!userInfo.stateName && userInfo.volunteerEngaged) console.log("Server: No U.S. state for voter but volunteer engaged, so disabling automated replies.")
        if (userInfo.stateName || userInfo.volunteerEngaged) {
          console.log("Server: handleClearedVoter");
          Router.handleClearedVoter({userInfo, userPhoneNumber, userMessage}, redisClient, twilioPhoneNumber, inboundDbMessageEntry);
        // Voter has no state determined
        } else {
          console.log("Server: determineVoterState");
          Router.determineVoterState({userInfo, userPhoneNumber, userMessage}, redisClient, twilioPhoneNumber, inboundDbMessageEntry);
        }
      } else {
        console.log("Server: handleDisclaimer");
        Router.handleDisclaimer({userInfo, userPhoneNumber, userMessage}, redisClient, twilioPhoneNumber, inboundDbMessageEntry);
      }
    // Haven't seen this voter before
    } else {
      console.log("Server: handleNewVoter");
      Router.handleNewVoter({userPhoneNumber, userMessage, userId}, redisClient, twilioPhoneNumber, inboundDbMessageEntry, entryPoint);
    }
  });
};

app.post('/push', (req, res) => {
  const MESSAGE = "This is Voter Help Line! Do you have any voting questions? Reply to instantly connect with a volunteer. Text STOP to stop messages. Msg & data rates may apply.";
  const TWILIO_PHONE_NUMBER = "+18557041009";
  const USER_PHONE_NUMBERS = [
    "+18183702015",
    "+18183702015",
    "+18183702015",
  ];

  let delay = 0;
  let INTERVAL_MILLISECONDS = 5000;
  for (let idx in USER_PHONE_NUMBERS) {
    const userPhoneNumber = USER_PHONE_NUMBERS[idx];
    const dbMessageEntry = {
      direction: "OUTBOUND",
      automated: true,
      // ADD ENTRY POINT
    };
    setTimeout(TwilioApiUtil.sendMessage, delay, MESSAGE,
                {twilioPhoneNumber: TWILIO_PHONE_NUMBER, userPhoneNumber},
                dbMessageEntry);
    delay += INTERVAL_MILLISECONDS;
  }
  res.status(200).json({ message: "success" });
});

app.post('/twilio-push', (req, res) => {
  const twiml = new MessagingResponse();
  handleIncomingTwilioMessage(req, LoadBalancer.PUSH_ENTRY_POINT);

  res.writeHead(200, {'Content-Type': 'text/xml'});
  res.end(twiml.toString());
});


app.post('/twilio-pull', (req, res) => {
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
  console.log(JSON.stringify(req.headers));
  res.type('application/json');

  if (!req.body.challenge) {
    const reqBody = req.body;
    if(process.env.NODE_ENV !== "development" && !passesAuth(req)) {
      console.log('doesnt pass auth');
      res.sendStatus(401);
      return;
    }
    res.sendStatus(200);
    console.log('Passes Slack auth');
    if (reqBody.event.type === "message"
        && reqBody.event.user != process.env.SLACK_BOT_USER_ID) {
      const redisHashKey = `${reqBody.event.channel}:${reqBody.event.thread_ts}`;

      // Pass Slack message to Twilio
      RedisApiUtil.getHash(redisClient, redisHashKey).then(redisData => {
        if (redisData != null) {
          SlackApiUtil.fetchSlackUserName(reqBody.event.user).then(originatingSlackUserName => {
            Router.handleSlackVoterThreadMessage(req, redisClient, redisData, originatingSlackUserName);
          });
        } else {
          // Hash doesn't exist (this message is likely outside of a voter thread).
          console.log("Server received Slack message outside a voter thread.")
        }
      });
    } else if (reqBody.event.type === "app_mention"
                // Require that the Slack bot be the (first) user mentioned.
                && reqBody.authed_users[0] === process.env.SLACK_BOT_USER_ID
                // Require that the message was sent in the #admin-control-room Slack channel
                && reqBody.event.channel == process.env.ADMIN_CONTROL_ROOM_SLACK_CHANNEL_ID) {
      SlackApiUtil.fetchSlackUserName(reqBody.event.user).then(originatingSlackUserName => {
        console.log(`Received admin control command from ${originatingSlackUserName}: ${reqBody.event.text}`);
        Router.handleSlackAdminCommand(reqBody, redisClient, originatingSlackUserName);
      });
    }
  } else {
    // Authenticate Slack connection to Heroku.
    if (SlackApiUtil.authenticateConnectionToSlack(req.body.token)) {
      res.status(200).json({ challenge: req.body.challenge });
    }
  }
});

http.listen(process.env.PORT || 8080, function() {
  console.log('listening on *:8080');
});
