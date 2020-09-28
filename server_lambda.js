const awsServerlessExpress = require('aws-serverless-express');
const app = require('./app').app;
const server = awsServerlessExpress.createServer(app);

const handler = (event, context) => {
  return awsServerlessExpress.proxy(server, event, context, 'PROMISE').promise;
};

if (process.env.SENTRY_DSN) {
  const Sentry = require('@sentry/serverless');

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
  });

  exports.handler = Sentry.AWSLambda.wrapHandler(handler);
} else {
  exports.handler = handler;
}
