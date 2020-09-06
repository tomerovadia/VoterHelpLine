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
const MessageConstants = require('./message_constants');
const RouterUtil = require('./router_util');
const Hashes = require('jshashes'); // v1.0.5
const bodyParser = require('body-parser');
const multer = require('multer'); // v1.0.5
const crypto = require('crypto');
const upload = multer(); // for parsing multipart/form-data
const MessagingResponse = require('twilio').twiml.MessagingResponse;
const { Client } = require('pg');
const DbApiUtil = require('./db_api_util');
const RedisApiUtil = require('./redis_api_util');
const MessageParser = require('./message_parser');

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

app.post('/twilio-sms', (req, res) => {
  const twiml = new MessagingResponse();
  console.log('receiving Twilio message');
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
  });

  const redisHashKey = `${userId}:${twilioPhoneNumber}`;

  RedisApiUtil.getHash(redisClient, redisHashKey).then(userInfo => {
    // Seen this voter before
    if (userInfo != null) {
      if (userInfo.confirmedDisclaimer) {
        // Voter has a state determined
        if (userInfo.stateChannelChannel) {
          RouterUtil.handleClearedVoter({userInfo, userPhoneNumber, userMessage}, redisClient, twilioPhoneNumber, inboundDbMessageEntry);
        // Voter has no state determined
        } else {
          RouterUtil.determineVoterState({userInfo, userPhoneNumber, userMessage}, redisClient, twilioPhoneNumber, inboundDbMessageEntry);
        }
      } else {
        RouterUtil.handleDisclaimer({userInfo, userPhoneNumber, userMessage}, redisClient, twilioPhoneNumber, inboundDbMessageEntry);
      }
    // Haven't seen this voter before
    } else {
      RouterUtil.handleNewVoter({userPhoneNumber, userMessage}, redisClient, twilioPhoneNumber, inboundDbMessageEntry);
    }
  });

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

  const reqBody = req.body;
  // if(!passesAuth(req)) {
  //   console.log('doesnt pass auth');
  //   res.sendStatus(401);
  //   return;
  // }
  res.sendStatus(200);
  console.log('Passes Slack auth');

  if (reqBody.event.type === "message"
      && reqBody.event.user != process.env.SLACK_BOT_USER_ID) {
    const redisHashKey = `${reqBody.event.channel}:${reqBody.event.thread_ts}`;

    // Pass Slack message to Twilio
    RedisApiUtil.getHash(redisClient, redisHashKey).then(redisData => {
      if (redisData != null) {
        const userPhoneNumber = redisData.userPhoneNumber;
        const twilioPhoneNumber = redisData.twilioPhoneNumber;
        if (userPhoneNumber) {
          const unprocessedSlackMessage = reqBody.event.text;
          console.log(`Received message from Slack: ${unprocessedSlackMessage}`);

          // If the message doesnt need processing.
          let messageToSend = unprocessedSlackMessage;
          let unprocessedMessageToLog = null;
          const processedSlackMessage = MessageParser.processMessageText(unprocessedSlackMessage);
          // If the message did need processing.
          if (processedSlackMessage != null) {
            messageToSend = processedSlackMessage;
            unprocessedMessageToLog = unprocessedSlackMessage;
          }
          const MD5 = new Hashes.MD5;
          const userId = MD5.hex(userPhoneNumber);

          const outboundDbMessageEntry = DbApiUtil.populateIncomingDbMessageSlackEntry({
            userId,
            originatingSlackUserId: reqBody.event.user,
            slackChannel: reqBody.event.channel,
            slackParentMessageTs: reqBody.event.thread_ts,
            slackMessageTs: reqBody.event.ts,
            unprocessedMessage: unprocessedMessageToLog,
            slackRetryNum: req.header('X-Slack-Retry-Num'),
            slackRetryReason: req.header('X-Slack-Retry-Reason'),
          });

          RedisApiUtil.getHash(redisClient, `${userId}:${twilioPhoneNumber}`).then(userInfo => {
            if (userInfo != null) {
              userInfo.lastVoterMessageSecsFromEpoch = Math.round(Date.now() / 1000);
              RedisApiUtil.setHash(redisClient, `${userPhoneNumber}:${twilioPhoneNumber}`, userInfo);
              DbApiUtil.updateDbMessageEntryWithUserInfo(userInfo, outboundDbMessageEntry);
              TwilioApiUtil.sendMessage(messageToSend,
                                        {userPhoneNumber,
                                          twilioPhoneNumber},
                                          outboundDbMessageEntry);
            }
          });
        }
      // Hash doesn't exist (this message is likely outside of a voter thread).
      } else {
        console.log("Server received Slack message outside a voter thread.")
      }
    });
  }
});

// Authenticate Slack connection to Heroku.
// app.post('/slack', upload.array(), (req, res) => {
//   // if(!passesAuth(req)) {
//   //   console.log('doesnt pass auth');
//   //   res.sendStatus(401);
//   //   return;
//   // }
//   res.type('application/json');
//   if (SlackApiUtil.authenticateConnectionToSlack(req.body.token)) {
//     res.status(200).json({ challenge: req.body.challenge });
//   }
//
//   res.sendStatus(200);
// });

http.listen(process.env.PORT || 8080, function() {
  console.log('listening on *:8080');
});
