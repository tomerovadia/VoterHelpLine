/* eslint @typescript-eslint/no-var-requires: off, @typescript-eslint/explicit-module-boundary-types: off */

// @ts-ignore
import awsServerlessExpress from 'aws-serverless-express';
import { app } from './app';

const server = awsServerlessExpress.createServer(app);

let handler = (event: any, context: any) => {
  return awsServerlessExpress.proxy(server, event, context, 'PROMISE').promise;
};

if (process.env.SENTRY_DSN) {
  const Sentry = require('@sentry/serverless');

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
  });

  handler = Sentry.AWSLambda.wrapHandler(handler);
}

export { handler };
