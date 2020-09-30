/* eslint @typescript-eslint/no-var-requires: off */

if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
  require('dotenv').config();
}

if (process.env.SENTRY_DSN) {
  const Sentry = require('@sentry/node');

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
  });
}

const { app } = require('./app');
const http = require('http').createServer(app);
const logger = require('./logger').default;

http.listen(process.env.PORT || 8080, function () {
  logger.info('listening on *:8080');
});
