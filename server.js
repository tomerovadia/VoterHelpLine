if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
  require('dotenv').config();
}

const express = require('express');
const app = express();
const http = require('http').createServer(app);;
const redis = require('redis');
const bluebird = require('bluebird');
const SlackApiUtil = require('./slack_api_util');
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
        // Voter has a state determined. The U.S. state name is used for
        // operator messages as well as to know whether a U.S. state is known
        // for the voter. This may not be ideal (create separate bool?).
        if (userInfo.stateName) {
          Router.handleClearedVoter({userInfo, userPhoneNumber, userMessage}, redisClient, twilioPhoneNumber, inboundDbMessageEntry);
        // Voter has no state determined
        } else {
          Router.determineVoterState({userInfo, userPhoneNumber, userMessage}, redisClient, twilioPhoneNumber, inboundDbMessageEntry);
        }
      } else {
        Router.handleDisclaimer({userInfo, userPhoneNumber, userMessage}, redisClient, twilioPhoneNumber, inboundDbMessageEntry);
      }
    // Haven't seen this voter before
    } else {
      Router.handleNewVoter({userPhoneNumber, userMessage}, redisClient, twilioPhoneNumber, inboundDbMessageEntry);
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

// app.post('/slack', upload.array(), (req, res) => {
//   console.log(JSON.stringify(req.headers));
//   res.type('application/json');
//
//   const reqBody = req.body;
//   if(!passesAuth(req)) {
//     console.log('doesnt pass auth');
//     res.sendStatus(401);
//     return;
//   }
//   res.sendStatus(200);
//   console.log('Passes Slack auth');
//
//   SlackApiUtil.fetchSlackUserName(reqBody.event.user).then(originatingSlackUserName => {
//     if (reqBody.event.type === "message"
//         && reqBody.event.user != process.env.SLACK_BOT_USER_ID) {
//       const redisHashKey = `${reqBody.event.channel}:${reqBody.event.thread_ts}`;
//
//       // Pass Slack message to Twilio
//       RedisApiUtil.getHash(redisClient, redisHashKey).then(redisData => {
//         if (redisData != null) {
//           Router.handleSlackVoterThreadMessage(req, redisClient, redisData, originatingSlackUserName);
//         } else {
//           // Hash doesn't exist (this message is likely outside of a voter thread).
//           console.log("Server received Slack message outside a voter thread.")
//         }
//       });
//     } else if (reqBody.event.type === "app_mention"
//                 // Require that the Slack bot be the (first) user mentioned.
//                 && reqBody.authed_users[0] === process.env.SLACK_BOT_USER_ID
//                 // Require that the message was sent in the #admin-control-room Slack channel
//                 && reqBody.event.channel == process.env.ADMIN_CONTROL_ROOM_SLACK_CHANNEL_ID) {
//       console.log(`Received admin control command: ${reqBody.event.text}`);
//       Router.handleSlackAdminCommand(reqBody, redisClient, originatingSlackUserName);
//     }
//   });
// });

// Authenticate Slack connection to Heroku.
app.post('/slack', upload.array(), (req, res) => {
  // if(!passesAuth(req)) {
  //   console.log('doesnt pass auth');
  //   res.sendStatus(401);
  //   return;
  // }
  res.type('application/json');
  if (SlackApiUtil.authenticateConnectionToSlack(req.body.token)) {
    res.status(200).json({ challenge: req.body.challenge });
  }

  res.sendStatus(200);
});

http.listen(process.env.PORT || 8080, function() {
  console.log('listening on *:8080');
});
