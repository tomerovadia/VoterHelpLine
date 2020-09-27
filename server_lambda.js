const awsServerlessExpress = require('aws-serverless-express')
const app = require('./app').app;
const server = awsServerlessExpress.createServer(app)

const handler = (event, context) => { awsServerlessExpress.proxy(server, event, context) }

if (process.env.SENTRY_DSN) {
  const Sentry = require("@sentry/serverless");

  console.log("GOT SENTRY DSN", process.env.SENTRY_DSN)
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    debug: true,
  });

  exports.handler = Sentry.AWSLambda.wrapHandler(handler);
} else {
  console.log("NO SENTRY DSN")
  exports.handler = handler;
}

