const axios = require('axios');
const Hashes = require('jshashes') // v1.0.5
const Promise = require('bluebird');

const sendMessage = (message, options) => {
  return axios.post('https://slack.com/api/chat.postMessage', {
    'Content-Type': 'application/json',
    'channel': options.channel,
    'text': message,
    'token': process.env.SLACK_BOT_ACCESS_TOKEN,
    'thread_ts': options.parentMessageTs,
  },
  {
    'headers': {
      "Authorization": `Bearer ${process.env.SLACK_BOT_ACCESS_TOKEN}`,
    },
  })
  .then(response => {
    console.log(`Successfully sent message to Slack: ${message}`);
    return response;
  })
  .catch(error => {
    console.log(error);
    return error;
  });
}

exports.sendMessage = sendMessage;

exports.sendMessages = (messages, options) => {
  parentMessageTs = options.parentMessageTs;
  channel = options.channel;

  messagePromises = messages.map(message => Promise.resolve(message));

  Promise.mapSeries(messagePromises, (message, index, arrayLength) => {
    return sendMessage(message, {parentMessageTs, channel});
  });
}

exports.authenticateConnectionToSlack = (token) => {
  const MD5 = new Hashes.MD5
  if(MD5.hex(token) == "644b337cc16ab46c98bd681230ce76c2"){
    console.log("token verified");
    return true;
  } else {
    console.log("token unauthorized");
    return false;
  }
}

exports.sendBackChallenge = (req) => {
  res.status(200).json({ challenge: req.body.challenge });
}
