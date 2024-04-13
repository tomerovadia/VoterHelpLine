/* eslint @typescript-eslint/no-var-requires: off, @typescript-eslint/explicit-module-boundary-types: off */

// @ts-ignore
import awsServerlessExpress from 'aws-serverless-express';
import { app } from './app';
import { wrapLambdaHandlerForSentry } from './sentry_wrapper';

const server = awsServerlessExpress.createServer(app);

export const handler = wrapLambdaHandlerForSentry(
  (event: any, context: any) => {
    return awsServerlessExpress.proxy(server, event, context, 'PROMISE')
      .promise;
  }
);
