import winston from 'winston';

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
    logFormats[(process.env.LOG_FORMAT as keyof typeof logFormats) || 'cli']
  ),
  transports: [new winston.transports.Console()],
});

export default logger;
