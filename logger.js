const winston = require('winston');

const printFormat = winston.format.printf((info) => {
  const { timestamp, level, message, stack, ...restObj } = info;
  const rest = Object.keys(restObj).length ? JSON.stringify(restObj) : '';

  return `[${timestamp}] | ${level} ${message} ${rest} ${stack || ''}`;
});

const logFormats = {
  json: winston.format.json(),
  simple: printFormat,
  cli: winston.format.combine(winston.format.cli(), printFormat),
};

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'debug',
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    winston.format.timestamp(),
    logFormats[process.env.LOG_FORMAT || 'cli']
  ),
  transports: [new winston.transports.Console()],
});

// based on: https://www.digitalocean.com/community/tutorials/how-to-use-winston-to-log-node-js-applications
logger.stream = {
  write: function (message) {
    logger.info(message);
  },
};

module.exports = logger;
