/* eslint @typescript-eslint/no-var-requires: off */

type LambdaHandler = (event: any, context: any) => Promise<any>;

export function wrapLambdaHandlerForSentry(
  handler: LambdaHandler
): LambdaHandler {
  if (!process.env.SENTRY_DSN) {
    return handler;
  }

  const Sentry = require('@sentry/serverless');

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
  });

  const sentryWrappedHandler = Sentry.AWSLambda.wrapHandler(handler);
  return (event: any, context: any) => {
    return sentryWrappedHandler(event, context)
      .then((res: any) => Sentry.flush().then(() => Promise.resolve(res)))
      .catch((err: Error) => {
        Sentry.flush().then(() => Promise.reject(err));
      });
  };
}
