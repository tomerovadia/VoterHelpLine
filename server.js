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
  // const MD5 = new Hashes.MD5;
  // const userId = MD5.hex(userPhoneNumber);
  const twilioPhoneNumber = req.body.To;
  const userMessage = req.body.Body;

  const inboundDbMessageEntry = DbApiUtil.populateIncomingDbMessageTwilioEntry({
    userMessage,
    userPhoneNumber,
    twilioPhoneNumber,
    twilioMessageSid: req.body.SmsMessageSid,
  });

  redisClient.getAsync(userPhoneNumber).then(unparsedUserInfo => {
    // Seen this voter before
    if (unparsedUserInfo) {
      const userInfo = JSON.parse(unparsedUserInfo);

      if (userInfo.confirmedDisclaimer) {
        // Voter has a state determined
        if (userInfo.stateChannel) {
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

app.post('/slack', upload.array(), (req, res) => {
  res.type('application/json');

  const reqBody = req.body;
  if(!passesAuth(req)) {
    console.log('doesnt pass auth');
    res.sendStatus(401);
    return;
  }
  console.log('Passes Slack auth');

  if (reqBody.event.type === "message" && reqBody.event.user != process.env.SLACK_BOT_USER_ID) {
    console.log(`Received message from Slack: ${reqBody.event.text}`);

    // Pass Slack message to Twilio
    redisClient.getAsync(`${reqBody.event.channel}:${reqBody.event.thread_ts}`).then(unparsedPhoneNumberInfo => {
      // TODO Handle unexpected case where no record is found for voter
      if (unparsedPhoneNumberInfo) {
        const phoneNumberInfo = JSON.parse(unparsedPhoneNumberInfo);
        const userPhoneNumber = phoneNumberInfo.userPhoneNumber;
        const twilioPhoneNumber = phoneNumberInfo.twilioPhoneNumber;
        if (userPhoneNumber) {
          const MD5 = new Hashes.MD5;

          const outboundDbMessageEntry = DbApiUtil.populateIncomingDbMessageSlackEntry({
            userId: MD5.hex(userPhoneNumber),
            originatingSlackUserId: reqBody.event.user,
            slackChannel: reqBody.event.channel,
            slackParentMessageTs: reqBody.event.thread_ts,
            slackMessageTs: reqBody.event.ts,
          });

          redisClient.getAsync(userPhoneNumber).then(unparsedUserInfo => {
            if (unparsedUserInfo) {
              const userInfo = JSON.parse(unparsedUserInfo);
              userInfo.lastVoterMessageSecsFromEpoch = Math.round(Date.now() / 1000);
              redisClient.setAsync(userPhoneNumber, JSON.stringify(userInfo));
              return userInfo;
            }
          }).then(userInfo => {
            DbApiUtil.updateDbMessageEntryWithUserInfo(userInfo, outboundDbMessageEntry);
            TwilioApiUtil.sendMessage(reqBody.event.text,
                                      {userPhoneNumber,
                                        twilioPhoneNumber},
                                        outboundDbMessageEntry);
          });
        }
      }
    });
  }
  res.sendStatus(200);
});

// app.get('/test-db', upload.array(), (req, res) => {
//   console.log('tesjt-dfg');
//   const databaseClient = new Client({
//     connectionString: process.env.DATABASE_URL,
//   });
//   databaseClient.connect()
//     .then(() => {
//       databaseClient.query("INSERT INTO messages (message, automated) VALUES ($1, $2);", ['oh hey', true], (err, res) => {
//         if (err) throw err;
//         console.log("No error from database query");
//         databaseClient.end();
//       });
//     })
//     .catch(err => console.error('Database connection error', err.stack));
//
//   res.sendStatus(200);
// });

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
