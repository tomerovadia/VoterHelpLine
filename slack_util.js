const crypto = require('crypto');
const logger = require('./logger');

exports.passesAuth = (req) => {
  const requestTimestamp = req.header('X-Slack-Request-Timestamp');
  if (!requestTimestamp
         || Math.abs((new Date().getTime() / 1000) - requestTimestamp) > 60 * 5
         || !process.env.SLACK_SIGNING_SECRET) {
    logger.error('ERROR Fails auth');
    return false;
  }

  const baseString = ['v0', requestTimestamp, req.rawBody].join(':');
  // const baseString = ['v0', requestTimestamp, req.rawBody].join(':');
  const slackSignature = 'v0=' + crypto
                                  .createHmac('sha256',
                                    process.env.SLACK_SIGNING_SECRET)
                                  .update(baseString, 'utf8')
                                  .digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(slackSignature, 'utf8'),
                 Buffer.from(req.header('X-Slack-Signature'), 'utf8'))) {
    logger.error('ERROR Fails auth');
    return false;
  }

  return true;
};
