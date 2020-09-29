import express from 'express';
import Hashes from 'jshashes';
import bodyParser from 'body-parser';
import twilio from 'twilio';
import * as Sentry from '@sentry/node';
import morgan from 'morgan';
import axios, { AxiosResponse } from 'axios';
import { Pool } from 'pg';

import * as SlackApiUtil from './slack_api_util';
import * as TwilioApiUtil from './twilio_api_util';
import * as Router from './router';
import * as DbApiUtil from './db_api_util';
import * as RedisApiUtil from './redis_api_util';
import * as LoadBalancer from './load_balancer';
import * as SlackUtil from './slack_util';
import * as TwilioUtil from './twilio_util';
import * as SlackInteractionHandler from './slack_interaction_handler';
import logger from './logger';
import redisClient from './redis_client';
import { EntryPoint, Request, UserInfo } from './types';

const app = express();
const MessagingResponse = twilio.twiml.MessagingResponse;

const rawBodySaver = (
  req: Request,
  res: express.Response,
  buf?: Buffer,
  encoding?: string
) => {
  if (buf && buf.length) {
    req.rawBody = buf.toString((encoding as BufferEncoding) || 'utf8');
  }
};

function runAsyncWrapper(
  callback: (
    req: Request,
    res: express.Response,
    next: express.NextFunction
  ) => Promise<any>
) {
  return function (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    callback(req as Request, res, next).catch(next);
  };
}

app.use(Sentry.Handlers.requestHandler());
app.use(
  morgan('combined', {
    stream: {
      write: function (message) {
        logger.info(message);
      },
    },
  })
);

app.use(bodyParser.json({ verify: rawBodySaver }));
app.use(bodyParser.urlencoded({ verify: rawBodySaver, extended: false }));
app.use(
  bodyParser.raw({
    verify: rawBodySaver,
    type: function () {
      return true;
    },
  })
);
app.post(
  '/push',
  runAsyncWrapper(async (req: Request, res: express.Response) => {
    const TWILIO_PHONE_NUMBER = '+18557041009';
    const MESSAGE =
      'This is Voter Help Line! We sent you an absentee ballot request form. Did you receive it? Text STOP to stop messages. Msg & data rates may apply.';

    const redisUserPhoneNumbersKey = 'userPhoneNumbers';
    const userPhoneNumbers = await redisClient.lrangeAsync(
      redisUserPhoneNumbersKey,
      0,
      1000
    );

    if (!userPhoneNumbers) {
      logger.info('Could not read phone numbers from redis');
      return;
    }

    logger.info('userPhoneNumbers:');
    logger.info(userPhoneNumbers);
    let delay = 0;
    const INTERVAL_MILLISECONDS = 2000;
    for (const idx in userPhoneNumbers) {
      const userPhoneNumber = userPhoneNumbers[idx];
      logger.info(`Sending push message to phone number: ${userPhoneNumber}`);

      const MD5 = new Hashes.MD5();
      const userId = MD5.hex(userPhoneNumber);

      const dbMessageEntry: DbApiUtil.DatabaseMessageEntry = {
        direction: 'OUTBOUND',
        automated: true,
        userId,
        entryPoint: LoadBalancer.PUSH_ENTRY_POINT,
      };

      await new Promise((resolve) => {
        setTimeout(resolve, delay);
      });

      await TwilioApiUtil.sendMessage(
        MESSAGE,
        { twilioPhoneNumber: TWILIO_PHONE_NUMBER, userPhoneNumber },
        dbMessageEntry
      );

      delay += INTERVAL_MILLISECONDS;
    }

    res.sendStatus(200);
  })
);

const handleIncomingTwilioMessage = async (
  req: Request,
  entryPoint: EntryPoint
) => {
  logger.info('Entering SERVER.handleIncomingTwilioMessage');

  const userPhoneNumber = req.body.From;

  const isBlocked = await RedisApiUtil.getHashField(
    redisClient,
    'twilioBlockedUserPhoneNumbers',
    userPhoneNumber
  );

  if (isBlocked === '1') {
    logger.info(
      `SERVER POST /twilio-push: Received text from blocked phone number: ${userPhoneNumber}.`
    );
    return;
  }

  const twilioPhoneNumber = req.body.To;
  const userMessage = req.body.Body;
  const MD5 = new Hashes.MD5();
  const userId = MD5.hex(userPhoneNumber);
  logger.info(`SERVER.handleIncomingTwilioMessage: Receiving Twilio message from ${entryPoint} entry point voter,
                userPhoneNumber: ${userPhoneNumber},
                twilioPhoneNumber: ${twilioPhoneNumber},
                userMessage: ${userMessage},
                userId: ${userId}`);

  const inboundDbMessageEntry = DbApiUtil.populateIncomingDbMessageTwilioEntry({
    userMessage,
    userPhoneNumber,
    twilioPhoneNumber,
    twilioMessageSid: req.body.SmsMessageSid,
    entryPoint: LoadBalancer.PUSH_ENTRY_POINT,
  });

  const redisHashKey = `${userId}:${twilioPhoneNumber}`;

  logger.info(
    `SERVER.handleIncomingTwilioMessage (${userId}): Retrieving userInfo using redisHashKey: ${redisHashKey}`
  );

  const userInfo = (await RedisApiUtil.getHash(
    redisClient,
    redisHashKey
  )) as UserInfo;
  logger.info(
    `SERVER.handleIncomingTwilioMessage (${userId}): Successfully received Redis response for userInfo retrieval with redisHashKey ${redisHashKey}, userInfo: ${JSON.stringify(
      userInfo
    )}`
  );

  // Seen this voter before
  if (userInfo != null) {
    logger.info(
      `SERVER.handleIncomingTwilioMessage (${userId}): Voter is known to us (Redis returned userInfo for redisHashKey ${redisHashKey})`
    );
    // PUSH
    if (entryPoint === LoadBalancer.PUSH_ENTRY_POINT) {
      logger.info(
        `SERVER.handleIncomingTwilioMessage (${userId}): Skipping automated system since entrypoint is ${LoadBalancer.PUSH_ENTRY_POINT}.`
      );
      // Don't do dislcaimer or U.S. state checks for push voters.
      await Router.handleClearedVoter(
        { userInfo, userPhoneNumber, userMessage },
        redisClient,
        twilioPhoneNumber,
        inboundDbMessageEntry
      );
      // PULL
    } else if (userInfo.confirmedDisclaimer) {
      logger.info(
        `SERVER.handleIncomingTwilioMessage (${userId}): Activating automated system since entrypoint is ${LoadBalancer.PULL_ENTRY_POINT}.`
      );
      logger.info(
        `SERVER.handleIncomingTwilioMessage (${userId}): Voter has previously confirmed the disclaimer.`
      );
      // Voter has a state determined. The U.S. state name is used for
      // operator messages as well as to know whether a U.S. state is known
      // for the voter. This may not be ideal (create separate bool?).
      // If a volunteer has intervened, turn off automated replies.
      if (userInfo.stateName || userInfo.volunteerEngaged) {
        logger.info(
          `SERVER.handleIncomingTwilioMessage (${userId}): Known U.S. state for voter (${userInfo.stateName}) or volunteer has engaged (${userInfo.volunteerEngaged}). Automated system no longer active.`
        );
        await Router.handleClearedVoter(
          { userInfo, userPhoneNumber, userMessage },
          redisClient,
          twilioPhoneNumber,
          inboundDbMessageEntry
        );
        // Voter has no state determined
      } else {
        logger.info(
          `SERVER.handleIncomingTwilioMessage (${userId}): U.S. state for voter is not known. Automated system will attempt to determine.`
        );
        await Router.determineVoterState(
          { userInfo, userPhoneNumber, userMessage },
          redisClient,
          twilioPhoneNumber,
          inboundDbMessageEntry
        );
      }
    } else {
      logger.info(
        `SERVER.handleIncomingTwilioMessage (${userId}): Activating automated system since entrypoint is ${LoadBalancer.PULL_ENTRY_POINT}`
      );
      logger.info(
        `SERVER.handleIncomingTwilioMessage (${userId}): Voter has NOT previously confirmed the disclaimer. Automated system will attempt to confirm.`
      );
      await Router.handleDisclaimer(
        { userInfo, userPhoneNumber, userMessage },
        redisClient,
        twilioPhoneNumber,
        inboundDbMessageEntry
      );
    }
    // Haven't seen this voter before
  } else {
    logger.info(
      `SERVER.handleIncomingTwilioMessage (${userId}): Voter is new to us (Redis returned no userInfo for redisHashKey ${redisHashKey})`
    );
    await Router.handleNewVoter(
      { userPhoneNumber, userMessage, userId },
      redisClient,
      twilioPhoneNumber,
      inboundDbMessageEntry,
      entryPoint
    );
  }
};

app.post(
  '/twilio-push',
  runAsyncWrapper(async (req, res) => {
    logger.info(
      '**************************************************************************************************'
    );
    logger.info(
      '******************************************************************************************************'
    );
    logger.info('Entering SERVER POST /twilio-push');
    const twiml = new MessagingResponse();

    if (TwilioUtil.passesAuth(req)) {
      logger.info('SERVER.handleIncomingTwilioMessage: Passes Twilio auth.');
      await handleIncomingTwilioMessage(req, LoadBalancer.PUSH_ENTRY_POINT);
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(twiml.toString());
    } else {
      logger.error(
        'SERVER.handleIncomingTwilioMessage: ERROR authenticating /twilio-push request is from Twilio.'
      );
      res.writeHead(401, { 'Content-Type': 'text/xml' });
      res.end(twiml.toString());
    }
  })
);

app.post(
  '/twilio-pull',
  runAsyncWrapper(async (req, res) => {
    logger.info(
      '**************************************************************************************************'
    );
    logger.info(
      '******************************************************************************************************'
    );
    logger.info('Entering SERVER POST /twilio-pull');
    const twiml = new MessagingResponse();

    if (TwilioUtil.passesAuth(req)) {
      logger.info('SERVER.handleIncomingTwilioMessage: Passes Twilio auth.');
      await handleIncomingTwilioMessage(req, LoadBalancer.PULL_ENTRY_POINT);
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(twiml.toString());
    } else {
      logger.error(
        'SERVER.handleIncomingTwilioMessage: ERROR authenticating /twilio-pull request is from Twilio.'
      );
      res.writeHead(401, { 'Content-Type': 'text/xml' });
      res.end(twiml.toString());
    }
  })
);

const isSlackRetry = (req: Request): boolean => {
  return 'x-slack-retry-reason' in req.headers;
};

app.post(
  '/slack',
  runAsyncWrapper(async (req, res) => {
    logger.info(
      '**************************************************************************************************'
    );
    logger.info(
      '******************************************************************************************************'
    );
    logger.info('Entering SERVER POST /slack');
    res.type('application/json');

    if (req.body.challenge) {
      logger.info(
        'SERVER POST /slack: Authenticating Slack bot event listener with Node server.'
      );
      // Authenticate Slack connection to Heroku.
      if (SlackApiUtil.authenticateConnectionToSlack(req.body.token)) {
        logger.info(
          'SERVER POST /slack: Slack-Node authentication successful.'
        );
        res.status(200).json({ challenge: req.body.challenge });
      } else {
        res.sendStatus(401);
      }

      return;
    }

    if (!SlackUtil.passesAuth(req)) {
      logger.error(
        'SERVER POST /slack: ERROR in authenticating /slack request is from Slack.'
      );
      res.sendStatus(401);
      return;
    }

    const reqBody = req.body;
    if (!reqBody || !reqBody.event) {
      logger.error(`SERVER POST /slack: Issue with Slack reqBody: ${reqBody}.`);
      return;
    }

    if (
      reqBody.event.type === 'message' &&
      reqBody.event.user != process.env.SLACK_BOT_USER_ID
    ) {
      logger.info(
        `SERVER POST /slack: Slack event listener caught non-bot Slack message from ${reqBody.event.user}.`
      );
      const redisHashKey = `${reqBody.event.channel}:${reqBody.event.thread_ts}`;

      // Pass Slack message to Twilio
      const redisData = (await RedisApiUtil.getHash(
        redisClient,
        redisHashKey
      )) as UserInfo;
      if (redisData != null) {
        logger.info(
          'SERVER POST /slack: Server received non-bot Slack message INSIDE a voter thread.'
        );

        const isBlocked = await RedisApiUtil.getHashField(
          redisClient,
          'slackBlockedUserPhoneNumbers',
          redisData.userPhoneNumber
        );
        if (isBlocked != '1') {
          const originatingSlackUserName = await SlackApiUtil.fetchSlackUserName(
            reqBody.event.user
          );
          if (!originatingSlackUserName) {
            throw new Error(
              `Could not get slack user name for slack user ${reqBody.event.user}`
            );
          }

          logger.info(
            `SERVER POST /slack: Successfully determined Slack user name of message sender: ${originatingSlackUserName}, from Slack user ID: ${reqBody.event.user}`
          );
          await Router.handleSlackVoterThreadMessage(
            req,
            redisClient,
            redisData,
            originatingSlackUserName
          );
        } else {
          logger.info(
            `SERVER POST /slack: Received attempted Slack message to blocked phone number: ${redisData.userPhoneNumber}`
          );
          await SlackApiUtil.sendMessage(
            `*Operator:* Your message was not relayed, as this phone number has been added to our blocklist.`,
            {
              channel: reqBody.event.channel,
              parentMessageTs: reqBody.event.thread_ts,
            }
          );
        }
      } else {
        // Hash doesn't exist (this message is likely outside of a voter thread).
        logger.info(
          'SERVER POST /slack: Server received non-bot Slack message OUTSIDE a voter thread. Doing nothing.'
        );
      }
    } else if (
      reqBody.event.type === 'app_mention' &&
      // Require that the Slack bot be the (first) user mentioned.
      reqBody.authed_users[0] === process.env.SLACK_BOT_USER_ID &&
      !isSlackRetry(req)
    ) {
      const originatingSlackUserName = await SlackApiUtil.fetchSlackUserName(
        reqBody.event.user
      );
      if (!originatingSlackUserName) {
        throw new Error(
          `Could not get slack user name for slack user ${reqBody.event.user}`
        );
      }
      logger.info(
        `SERVER POST /slack: Successfully determined Slack user name of bot mentioner: ${originatingSlackUserName}, from Slack user ID: ${reqBody.event.user}`
      );
      // For these commands, require that the message was sent in the #admin-control-room Slack channel.
      if (
        reqBody.event.channel ===
        process.env.ADMIN_CONTROL_ROOM_SLACK_CHANNEL_ID
      ) {
        logger.info(
          'SERVER POST /slack: Slack event listener caught bot mention in admin channel.'
        );
        logger.info(
          `SERVER POST /slack: Received admin control command from ${originatingSlackUserName}: ${reqBody.event.text}`
        );
        await Router.handleSlackAdminCommand(
          reqBody,
          redisClient,
          originatingSlackUserName
        );
      }
    }

    res.sendStatus(200);
  })
);

app.post(
  '/slack-interactivity',
  runAsyncWrapper(async (req, res) => {
    logger.info(
      '**************************************************************************************************'
    );
    logger.info(
      '******************************************************************************************************'
    );
    logger.info('Entering SERVER POST /slack-interactivity');

    if (!SlackUtil.passesAuth(req)) {
      logger.error(
        'SERVER POST /slack-interactivity: ERROR in authenticating request is from Slack.'
      );
      res.sendStatus(401);
      return;
    }
    logger.info('SERVER POST /slack-interactivity: PASSES AUTH');

    // Sanity check
    if (!req.body || !req.body.payload) {
      logger.error(
        'SERVER POST /slack-interactivity: ERROR with req.body or req.body.payload.'
      );
      return;
    }

    const payload = JSON.parse(req.body.payload);

    const originatingSlackUserName = await SlackApiUtil.fetchSlackUserName(
      payload.user.id
    );
    if (!originatingSlackUserName) {
      throw new Error(
        `Could not get slack user name for slack user ${payload.user.id}`
      );
    }

    const originatingSlackChannelName = await SlackApiUtil.fetchSlackChannelName(
      payload.channel.id
    );
    if (!originatingSlackChannelName) {
      throw new Error(
        `Could not get slack channel name for slack channel ${payload.channel.id}`
      );
    }

    const redisHashKey = `${payload.channel.id}:${payload.container.thread_ts}`;
    const redisData = await RedisApiUtil.getHash(redisClient, redisHashKey);

    const selectedVoterStatus = payload.actions[0].selected_option
      ? payload.actions[0].selected_option.value
      : payload.actions[0].value;
    if (selectedVoterStatus) {
      logger.info(
        `SERVER POST /slack-interactivity: Determined user interaction is a voter status update or undo.`
      );
      await SlackInteractionHandler.handleVoterStatusUpdate({
        payload,
        selectedVoterStatus,
        originatingSlackUserName,
        originatingSlackChannelName,
        userPhoneNumber: redisData.userPhoneNumber,
        twilioPhoneNumber: redisData.twilioPhoneNumber,
        redisClient,
      });
    } else if (payload.actions[0].selected_user) {
      logger.info(
        `SERVER POST /slack-interactivity: Determined user interaction is a volunteer update.`
      );
      await SlackInteractionHandler.handleVolunteerUpdate({
        payload,
        originatingSlackUserName,
        originatingSlackChannelName,
        userPhoneNumber: redisData.userPhoneNumber,
        twilioPhoneNumber: redisData.twilioPhoneNumber,
      });
    }

    res.sendStatus(200);
  })
);

app.get(
  '/debug-sentry',
  runAsyncWrapper(async function mainHandler() {
    await new Promise((resolve) => setTimeout(resolve, 100));

    Sentry.captureException(new Error('Explicit sentry error'));
    throw new Error('My first Sentry error!');
  })
);

app.get(
  '/debug-success',
  runAsyncWrapper(async function mainHandler(req, res) {
    await new Promise((resolve) => setTimeout(resolve, 100));

    res.sendStatus(200);
  })
);

function testHTTP() {
  return new Promise<void>((resolve) => {
    logger.info('START testHTTP');
    setTimeout(() => {
      logger.info('TIMEOUT testHTTP');
      resolve();
    }, 3000);

    void axios
      .get('https://google.com')
      .then((res: AxiosResponse) => {
        logger.info('PASS testHttp', res.status);
      })
      .catch((err) => {
        logger.info('FAIL testHttp', err);
      })
      .then(resolve);
  });
}

function testRedis() {
  return new Promise<void>((resolve) => {
    logger.info('START testRedis');
    setTimeout(() => {
      logger.info('TIMEOUT testRedis');
      resolve();
    }, 3000);

    void redisClient
      .pingAsync()
      .then((res: any) => {
        logger.info('PASS testRedis', res);
      })
      .catch((err: Error) => {
        logger.info('FAIL testRedis', err);
      })
      .then(resolve);
  });
}

function testPostgres() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.CONNECTION_POOL_MAX || 20),
  });

  return new Promise<void>((resolve) => {
    logger.info('START testPostgres');
    setTimeout(() => {
      logger.info('TIMEOUT testPostgres');
      resolve();
    }, 3000);

    void pool
      .connect()
      .then((client) => {
        return client.query('SELECT 1');
      })
      .then((res) => {
        logger.info('PASS testPostgres', res);
      })
      .catch((err) => {
        logger.info('FAIL testPostgres', err);
      })
      .then(resolve);
  });
}

app.get(
  '/debug-connect',
  runAsyncWrapper(async function mainHandler(req, res) {
    await Promise.all([testHTTP(), testRedis(), testPostgres()]);
    res.sendStatus(200);
  })
);

app.use(Sentry.Handlers.errorHandler());

app.use(function (err: Error, req: express.Request, res: express.Response) {
  logger.error(err);
  res.sendStatus(500);
});

export { app };
