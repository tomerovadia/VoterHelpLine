const axios = require('axios');
const Hashes = require('jshashes') // v1.0.5

exports.sendMessage = (options) => {
  return axios.post('https://slack.com/api/chat.postMessage', {
    'Content-Type': 'application/json',
    'channel': options.channel,
    'text': options.text,
    'token': process.env.BOT_ACCESS_TOKEN,
    'thread_ts': options.parentMessageTs,
  },
  {
    'headers': {
      "Authorization": `Bearer ${process.env.BOT_ACCESS_TOKEN}`,
    },
  })
  .then(response => {
    console.log("Successfully sent message.");
    console.log(response);
    return response;
  })
  .catch(error => {
    console.log(error);
    return error;
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
