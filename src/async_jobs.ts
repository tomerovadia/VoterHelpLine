/**
 * Slack requires that you respond to webhooks within 3 seconds. So when
 * responding to Slack webhooks, we kick off a background job and then respond
 * immediately with a 200.
 *
 * How we run background tasks depends on how we're deployed. By default, we
 * just run the task in the background. On Lambda, we instead invoke the
 * worker Lambda function (which runs this same codebase) asynchronously.
 */
import * as Sentry from '@sentry/node';

import * as SlackApiUtil from './slack_api_util';
import * as RedisApiUtil from './redis_api_util';
import * as SlackInteractionHandler from './slack_interaction_handler';
import * as Router from './router';
import logger from './logger';
import redisClient from './redis_client';
import Hashes from 'jshashes';
import * as DbApiUtil from './db_api_util';
import * as SlackBlockUtil from './slack_block_util';

import {
  SlackInteractionEventPayload,
  SlackModalPrivateMetadata,
} from './slack_interaction_handler';
import { wrapLambdaHandlerForSentry } from './sentry_wrapper';
import { SlackEventRequestBody } from './router';
import { UserInfo } from './types';

export type InteractivityHandlerMetadata = { viewId?: string };

async function slackCommandHandler(
  channelId: string,
  channelName: string,
  command: string,
  text: string
) {
  logger.info(`channel ${channelId} command ${command} text ${text}`);
  switch (command) {
    case '/unclaimed': {
      await SlackInteractionHandler.handleCommandUnclaimed(
        channelId,
        channelName,
        text
      );
      return;
    }
  }
  throw new Error(`Unrecognized command ${command}`);
}

async function slackInteractivityHandler(
  payload: SlackInteractionEventPayload,
  interactivityMetadata: InteractivityHandlerMetadata
) {
  const originatingSlackUserName = await SlackApiUtil.fetchSlackUserName(
    payload.user.id
  );
  if (!originatingSlackUserName) {
    throw new Error(
      `Could not get slack user name for slack user ${payload.user.id}`
    );
  }

  // Global shortcut
  if (payload.type === 'shortcut') {
    const { viewId } = interactivityMetadata;
    if (!viewId) {
      throw new Error(
        'slackInteractivityHandler called for message_action without viewId'
      );
    }
    switch (payload.callback_id) {
      case 'show_needs_attention': {
        await SlackInteractionHandler.handleShowNeedsAttention({
          payload,
          viewId,
        });
        return;
      }
    }
    throw new Error(`Unrecognized shortcut ${payload.callback_id}`);
  }

  // Message shortcut
  if (payload.type === 'message_action') {
    const originatingSlackChannelName = await SlackApiUtil.fetchSlackChannelName(
      payload.channel.id
    );

    const redisHashKey = `${payload.channel.id}:${payload.message.ts}`;
    const redisData = await RedisApiUtil.getHash(redisClient, redisHashKey);

    logger.info(
      `SERVER POST /slack-interactivity: Determined user interaction is a message shortcut.`
    );

    switch (payload.callback_id) {
      case 'set_needs_attention': {
        await DbApiUtil.setThreadNeedsAttentionToDb(
          payload.message.thread_ts || payload.message.ts,
          payload.channel.id,
          true
        );
        return;
      }

      case 'clear_needs_attention': {
        await DbApiUtil.setThreadNeedsAttentionToDb(
          payload.message.thread_ts || payload.message.ts,
          payload.channel.id,
          false
        );
        return;
      }

      case 'reset_demo': {
        const { viewId } = interactivityMetadata;
        if (!viewId) {
          throw new Error(
            'slackInteractivityHandler called for message_action without viewId'
          );
        }

        const MD5 = new Hashes.MD5();

        // Ignore Prettier formatting because this object needs to adhere to JSON strigify requirements.
        // prettier-ignore
        const modalPrivateMetadata = {
          "commandType": 'RESET_DEMO',
          "userId": redisData ? MD5.hex(redisData.userPhoneNumber) : null,
          "userPhoneNumber": redisData ? redisData.userPhoneNumber : null,
          "twilioPhoneNumber": redisData ? redisData.twilioPhoneNumber : null,
          "slackChannelId": payload.channel.id,
          "slackParentMessageTs": payload.message.ts,
          "originatingSlackUserName": originatingSlackUserName,
          "originatingSlackUserId": payload.user.id,
          "slackChannelName": originatingSlackChannelName,
          "actionTs": payload.action_ts
        } as SlackModalPrivateMetadata;

        await SlackInteractionHandler.receiveResetDemo({
          payload,
          redisClient,
          modalPrivateMetadata,
          twilioPhoneNumber: redisData ? redisData.twilioPhoneNumber : null,
          userId: MD5.hex(redisData.userPhoneNumber),
          viewId,
        });
        return;
      }

      default: {
        throw new Error(
          `slackInteractivityHandler unrecognized callback_id ${payload.callback_id}`
        );
      }
    }
  }

  // Block action
  if (payload.type === 'block_actions') {
    const originatingSlackChannelName = await SlackApiUtil.fetchSlackChannelName(
      payload.channel.id
    );
    if (!originatingSlackChannelName) {
      throw new Error(
        `Could not get slack channel name for Slack channel ${payload.channel.id}`
      );
    }

    const redisHashKey = `${payload.channel.id}:${payload.message.ts}`;
    const redisData = await RedisApiUtil.getHash(redisClient, redisHashKey);
    if (!redisData) {
      logger.debug(
        `SERVER POST /slack-interactivity: Received an interaction for a voter who no longer exists in Redis.`
      );
      return;
    }

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
        slackChannelName: originatingSlackChannelName,
        userPhoneNumber: redisData ? redisData.userPhoneNumber : null,
        twilioPhoneNumber: redisData ? redisData.twilioPhoneNumber : null,
        redisClient,
      });
    } else if (payload.actions[0].selected_user) {
      logger.info(
        `SERVER POST /slack-interactivity: Determined user interaction is a volunteer update.`
      );
      await SlackInteractionHandler.handleVolunteerUpdate({
        payload,
        originatingSlackUserName,
        slackChannelName: originatingSlackChannelName,
        userPhoneNumber: redisData ? redisData.userPhoneNumber : null,
        twilioPhoneNumber: redisData ? redisData.twilioPhoneNumber : null,
      });
    }
    return;
  }

  // Modal confirmation
  if (payload.type === 'view_submission') {
    // Get the data associated with the modal used for execution of the
    // action it confirmed.
    const modalPrivateMetadata = JSON.parse(
      payload.view.private_metadata
    ) as SlackModalPrivateMetadata;
    if (modalPrivateMetadata.commandType === 'RESET_DEMO') {
      await SlackInteractionHandler.handleResetDemo(
        redisClient,
        modalPrivateMetadata
      );
      return;
    }
    // If the view_submission interaction does not match one of the above types
    // exit and continue down to throw an error.
  }

  throw new Error(
    `Received an unexpected Slack interaction: ${JSON.stringify(payload)}`
  );
}

async function slackMessageEventHandler(
  reqBody: SlackEventRequestBody,
  twilioCallbackURL: string,
  {
    retryCount,
    retryReason,
  }: { retryCount: number | undefined; retryReason: string | undefined }
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

    const outboundTextsBlocked = await RedisApiUtil.getHashField(
      redisClient,
      'slackBlockedUserPhoneNumbers',
      redisData.userPhoneNumber
    );
    if (outboundTextsBlocked != '1') {
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
        reqBody,
        redisClient,
        redisData,
        originatingSlackUserName,
        twilioCallbackURL,
        { retryCount, retryReason }
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
}

async function slackAppMentionEventHandler(reqBody: SlackEventRequestBody) {
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
    reqBody.event.channel === process.env.ADMIN_CONTROL_ROOM_SLACK_CHANNEL_ID
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

const BACKGROUND_TASKS = {
  slackInteractivityHandler,
  slackMessageEventHandler,
  slackAppMentionEventHandler,
  slackCommandHandler,
};

export async function enqueueBackgroundTask(
  // These type declarations are a bit complicated -- basically, this is saying
  // that `taskName` must be one of the keys of BACKGROUND_TASKS, and that
  // `args` must match the arguments of that function
  taskName: keyof typeof BACKGROUND_TASKS,
  ...args: Parameters<typeof BACKGROUND_TASKS[typeof taskName]>
): Promise<void> {
  if (process.env.LAMBDA_BACKGROUND_TASK_FUNCTION) {
    // We require and instantiate the lambda client here rather than
    // at the top of the file so that we don't require aws-sdk in non-lambda
    // environment -- it's a very large library and it's included by default
    // in the Lambda environment so we don't need to declare it as a
    // dependency

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AWS = require('aws-sdk');
    const lambda = new AWS.Lambda();

    // use an async lambda invocation to run the background task
    logger.info(
      `Running background task ${taskName} via async lambda invocation`
    );
    const result = await lambda
      .invoke({
        FunctionName: process.env.LAMBDA_BACKGROUND_TASK_FUNCTION,
        Payload: JSON.stringify({
          taskName,
          args,
        }),
        InvocationType: 'Event',
      })
      .promise();
    logger.info(`Invoke result: ${result.StatusCode}`);
  } else {
    // just run the function, but don't await the promise so we don't block
    // on completion
    logger.info(`Running background task ${taskName} as a background promise`);

    // @ts-ignore Typescript can't follow this kind of dynamic function call
    BACKGROUND_TASKS[taskName](...args).catch((err) => {
      logger.error(err);
      Sentry.captureException(err);
    });
  }
}

export const backgroundLambdaHandler = wrapLambdaHandlerForSentry(
  async (event: any): Promise<void> => {
    logger.info(
      `Running Lambda background function with payload: ${JSON.stringify(
        event
      )}`
    );

    const { taskName, args } = event;

    if (!(taskName in BACKGROUND_TASKS)) {
      throw new Error(`Got an invalid task name: ${taskName}`);
    }

    // @ts-ignore Typescript can't check this -- everything's coming in from the
    // dynamic payload
    await BACKGROUND_TASKS[taskName](...args);
  }
);
