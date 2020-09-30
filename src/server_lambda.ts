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

  const sentryWrappedHandler = Sentry.AWSLambda.wrapHandler(handler);
  handler = (event: any, context: any) => {
    return sentryWrappedHandler(event, context)
      .then((res: any) => Sentry.flush().then(() => Promise.resolve(res)))
      .catch((err: Error) => {
        Sentry.flush().then(() => Promise.reject(err));
      });
  };
}

export { handler };
