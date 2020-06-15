const express = require('express');
const app = express();
const http = require('http').createServer(app);;
const path = require('path');
// var io = require('socket.io')(http);
const redis = require('redis');
const bluebird = require('bluebird');
const SlackApiUtil = require('./slack_api_util')
const Hashes = require('jshashes') // v1.0.5
const bodyParser = require('body-parser');
const multer = require('multer'); // v1.0.5
const crypto = require('crypto');
const upload = multer(); // for parsing multipart/form-data
const MessagingResponse = require('twilio').twiml.MessagingResponse;
const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

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

// Serves the front-end
app.use(express.static(path.join(__dirname, 'build')));

app.post('/twilio-sms', (req, res) => {
  const twiml = new MessagingResponse();
  console.log('receiving twilio message');
  console.log(req.body);
  console.log(req.body.Body);
  console.log(req.body.From);

  redisClient.getAsync(req.body.From).then(value => {
    if (value) {
      userInfo = JSON.parse(value);
      SlackApiUtil.sendMessage({
        text: `${req.body.From}: ${req.body.Body}`,
        parentMessageTs: userInfo.parentMessageTs,
        channel: userInfo.channel,
      });
    } else {
      // var redisSubClient = redis.createClient(process.env.REDISCLOUD_URL);
      redisClient.saddAsync(req.body.From);
      // redisSubClient.subscribe(req.body.From);

      // redisSubClient.on('message', function(channel, message) {
      //   console.log('incoming message from Slack', message);
        // twilioClient.messages
        //       .create({body: message,
        //                from: process.env.TWILIO_PHONE_NUMBER,
        //                to: req.body.From})
        //       .then(message => console.log(message.sid));
      // });

      SlackApiUtil.sendMessage({
        channel: "#north-carolina",
        text:  `New voter with questions on North Carolina! (id: ${req.body.From})`,
      }).then(response => {
          // Add key/value such that given a user phone number we can get the
          // Slack thread associated with that user.
          redisClient.setAsync(req.body.From,
                              JSON.stringify({
                                  parentMessageTs: response.data.ts,
                                  channel: '#north-carolina',
                                }));
          // Add key/value such that given Slack thread data we can get a
          // user phone number.
          redisClient.setAsync(`${response.data.channel}:${response.data.ts}`,
                              JSON.stringify({
                                  userPhoneNumber: req.body.From,
                                }));
          SlackApiUtil.sendMessage({
            text: `${req.body.From}: ${req.body.Body}`,
            parentMessageTs: response.data.ts,
            channel: response.data.channel,
          });
          console.log("publishing response");
          SlackApiUtil.sendMessage({
            text: "EffingVote: Welcome! We're activating a North Carolina volunteer. How can we help?",
            parentMessageTs: response.data.ts,
            channel: response.data.channel,
          });
          twilioClient.messages
                .create({body: "Welcome! We're activating a North Carolina volunteer. How can we help?",
                         from: process.env.TWILIO_PHONE_NUMBER,
                         to: req.body.From})
                .then(message => console.log(message.sid));
          // redisClient.publish(req.body.From, "Welcome! We're activating a North Carolina volunteer. How can we help?");
      });
    }
  });

  // if (req.body.Body == 'hello') {
  //   twiml.message('Hi!');
  // } else if (req.body.Body == 'bye') {
  //   twiml.message('Goodbye');
  // } else {
  //   twiml.message(
  //     'No Body param match, Twilio sends this in the request to your server.'
  //   );
  // }

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

// Main Slack code
app.post('/slack', upload.array(), (req, res) => {
  res.type('application/json');

  const reqBody = req.body;
  if(!passesAuth(req)) {
    console.log('doesnt pass auth');
    res.sendStatus(401);
    return;
  }
  console.log('passes auth');

  if (reqBody.event.type === "message" && reqBody.event.user != "U014LM9RXHU") {
    console.log('received message from slack');

    // Pass Slack message to front-end
    redisClient.getAsync(`${reqBody.event.channel}:${reqBody.event.thread_ts}`).then(value => {
      userInfo = JSON.parse(value);
      console.log(userInfo);
      // channel = null;
      // if (userInfo.socketId) {
      //   console.log('userInfo.socketId');
      //   console.log(userInfo.socketId);
      //   channel = userInfo.socketId;
      // } else
      if (userInfo.userPhoneNumber) {
        console.log('userInfo.userPhoneNumber');
        console.log(userInfo.userPhoneNumber);
        // channel = userInfo.userPhoneNumber;
        twilioClient.messages
              .create({body: reqBody.event.text,
                       from: process.env.TWILIO_PHONE_NUMBER,
                       to: userInfo.userPhoneNumber})
              .then(message => console.log(message.sid));
      }
      console.log('channel');
      console.log(channel);
      console.log('reqBody.event.text');
      console.log(reqBody.event.text);
      // redisClient.pubsubAsync('NUMSUB', channel).then(numsub => {
      //   console.log('numsub');
      //   console.log(numsub[1]);
      //   if (numsub[1] == 0) {
      //     var redisSubClient = redis.createClient(process.env.REDISCLOUD_URL);
      //     redisClient.saddAsync(channel);
      //     redisSubClient.subscribe(channel);
      //
      //     redisSubClient.on('message', function(channel, message) {
      //       console.log('incoming message from Slack', message);
      //       twilioClient.messages
      //             .create({body: message,
      //                      from: process.env.TWILIO_PHONE_NUMBER,
      //                      to: channel})
      //             .then(message => console.log(message.sid));
      //     });
      //   }
        redisClient.publish(channel, reqBody.event.text);
      // });
    });
  }
  res.sendStatus(200);
});

// Event listener for when a browser client connects to this server
// Use an `async` function, so we can use `await` below.
// io.on('connection', async function(socket) {
//   console.log("New connection");
//
//   SlackApiUtil.sendMessage({
//     channel: "#general",
//     text:  `Incoming voter! Determining which U.S. State... (id: ${socket.id})`,
//   });
//
//   // Event listener for when a browser client sends a message to this server
//   socket.on('message', function(message){
//     redisClient.getAsync(socket.id).then(value => {
//       if (value) {
//         userInfo = JSON.parse(value);
//         SlackApiUtil.sendMessage({
//           text: `${socket.id}: ${message}`,
//           parentMessageTs: userInfo.parentMessageTs,
//           channel: userInfo.channel,
//         });
//       } else if (message.match(/north carolina|nc/gi)) {
//         var redisSubClient = redis.createClient(process.env.REDISCLOUD_URL);
//         redisClient.saddAsync(socket.id);
//         redisSubClient.subscribe(socket.id);
//
//         redisSubClient.on('message', function(channel, message) {
//           console.log('incoming message from Slack', message);
//           socket.send(message);
//         });
//
//         SlackApiUtil.sendMessage({
//           channel: "#north-carolina",
//           text:  `New voter with questions on North Carolina! (id: ${socket.id})`,
//         }).then(response => {
//             redisClient.setAsync(socket.id,
//                                 JSON.stringify({
//                                     parentMessageTs: response.data.ts,
//                                     channel: '#north-carolina',
//                                   }));
//             redisClient.setAsync(`${response.data.channel}:${response.data.ts}`,
//                                 JSON.stringify({
//                                     socketId: socket.id,
//                                   }));
//             console.log("publishing response");
//             redisClient.publish(socket.id, "Great! We're activating a North Carolina volunteer. How can we help?");
//         });
//       } else if (message.match(/wisconsin|wi/gi)) {
//         var redisSubClient = redis.createClient(process.env.REDISCLOUD_URL);
//         redisClient.saddAsync(socket.id);
//         redisSubClient.subscribe(socket.id);
//
//         redisSubClient.on('message', function(channel, message) {
//           console.log('incoming message from Slack', message);
//           socket.send(message);
//         });
//
//         SlackApiUtil.sendMessage({
//           channel: "#wisconsin",
//           text:  `New voter with questions on Wisconsin! (id: ${socket.id})`,
//         }).then(response => {
//             redisClient.setAsync(socket.id,
//                                 JSON.stringify({
//                                     parentMessageTs: response.data.ts,
//                                     channel: '#wisconsin',
//                                   }));
//             redisClient.setAsync(`${response.data.channel}:${response.data.ts}`,
//                                 JSON.stringify({
//                                     socketId: socket.id,
//                                   }));
//             redisClient.publish(socket.id, "Great! We're activating a Wisconsin volunteer. How can we help?");
//         });
//       }
//     });
//   });
// });

// Authenticate Slack connection to Heroku.
// app.post('/slack', upload.array(), (req, res) => {
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
