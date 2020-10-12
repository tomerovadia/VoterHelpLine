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
import { SlackActionId, SlackCallbackId } from './slack_interaction_ids';
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

function getViewId(
  payload: SlackInteractionEventPayload,
  interactivityMetadata: InteractivityHandlerMetadata
) {
  if (payload.view && payload.view.id) return payload.view.id;

  const { viewId } = interactivityMetadata;
  if (viewId) return viewId;

  throw new Error('slackInteractivityHandler called without viewId');
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

  if (
    payload.type === 'shortcut' &&
    payload.callback_id === SlackCallbackId.OPEN_CLOSE_CHANNELS
  ) {
    logger.info(
      `SERVER POST /slack-interactivity: Determined user interaction is a OPEN_CLOSE_CHANNELS  shortcut.`
    );

    await SlackInteractionHandler.handleOpenCloseChannels({
      payload,
      redisClient,
      originatingSlackUserName,
      viewId: getViewId(payload, interactivityMetadata),
    });
    return;
  }

  // Handle open/close modal actions
  if (
    payload.type === 'block_actions' &&
    payload.actions &&
    [
      SlackActionId.OPEN_CLOSE_CHANNELS_FILTER_STATE,
      SlackActionId.OPEN_CLOSE_CHANNELS_FILTER_TYPE,
    ].includes(payload.actions[0].action_id as SlackActionId)
  ) {
    logger.info(
      `SERVER POST /slack-interactivity: Determined user interaction is in OPEN_CLOSE_CHANNELS modal`
    );

    const view = payload.view;
    if (!view) {
      throw new Error('OPEN_CLOSE_CHANNELS block_actions expected view');
    }

    await SlackInteractionHandler.handleOpenCloseChannels({
      payload,
      redisClient,
      originatingSlackUserName,
      viewId: getViewId(payload, interactivityMetadata),
      values: payload?.view?.state?.values,
      action: payload.actions[0],
    });
    return;
  }

  // Handle open/close modal submission
  if (
    payload.type === 'view_submission' &&
    payload.view?.callback_id === SlackCallbackId.OPEN_CLOSE_CHANNELS_MODAL
  ) {
    logger.info(
      `SERVER POST /slack-interactivity: Determined user interaction is a OPEN_CLOSE_CHANNELS_MODAL submission.`
    );

    await SlackInteractionHandler.handleOpenCloseChannels({
      payload,
      redisClient,
      originatingSlackUserName,
      viewId: getViewId(payload, interactivityMetadata),
      values: payload?.view?.state?.values,
      isSubmission: true,
    });
    return;
  }

  // Confirmation modal submission
  if (
    payload.type === 'view_submission' &&
    payload.view?.callback_id ===
      SlackCallbackId.OPEN_CLOSE_CHANNELS_CONFIRM_MODAL
  ) {
    logger.info(
      `SERVER POST /slack-interactivity: Determined user interaction is a OPEN_CLOSE_CHANNELS_MODAL_CONFIRM submission.`
    );

    await SlackInteractionHandler.handleOpenCloseChannels({
      payload,
      redisClient,
      originatingSlackUserName,
      viewId: payload?.view?.root_view_id,
      values: JSON.parse(payload?.view?.private_metadata),
      isSubmission: true,
    });
    return;
  }

  if (
    payload.type === 'block_actions' &&
    payload.actions[0].action_id ===
      SlackActionId.OPEN_CLOSE_CHANNELS_CHANNEL_STATE_DROPDOWN
  ) {
    // Noop -- this gets handled with submission
    return;
  }

  if (payload.type === 'block_actions' || payload.type === 'message_action') {
    const originatingSlackChannelName =
      payload.channel &&
      (await SlackApiUtil.fetchSlackChannelName(payload.channel.id));

    const redisHashKey = `${payload.channel.id}:${payload.message.ts}`;
    const redisData = await RedisApiUtil.getHash(redisClient, redisHashKey);

    // Exempt message_action, which will be handled later by updating the Slack user's modal.
    if (!(payload.type === 'message_action')) {
      if (!originatingSlackChannelName) {
        throw new Error(
          `Could not get slack channel name for Slack channel ${payload.channel.id}`
        );
      }
      if (!redisData) {
        logger.debug(
          `SERVER POST /slack-interactivity: Received an interaction for a voter who no longer exists in Redis.`
        );
        return;
      }
    }

    switch (payload.type) {
      case 'block_actions': {
        const selectedVoterStatus = payload.actions[0].selected_option
          ? payload.actions[0].selected_option.value
          : payload.actions[0].value;
        if (selectedVoterStatus) {
          logger.info(
            `SERVER POST /slack-interactivity: Determined user interaction is a voter status update or undo.`
          );
          await SlackInteractionHandler.handleVoterStatusUpdate({
            payload,
            selectedVoterStatus: selectedVoterStatus as SlackInteractionHandler.VoterStatusUpdate,
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
      case 'message_action': {
        logger.info(
          `SERVER POST /slack-interactivity: Determined user interaction is a message shortcut.`
        );

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

        if (!originatingSlackChannelName || !redisData) {
          modalPrivateMetadata.success = false;
          modalPrivateMetadata.failureReason = 'invalid_shortcut_use';
          await DbApiUtil.logCommandToDb(modalPrivateMetadata);
          const slackView = SlackBlockUtil.getErrorSlackView(
            'not_active_voter_parent_thread',
            'This shortcut is not valid on this message.'
          );
          await SlackApiUtil.updateModal(viewId, slackView);
          logger.info(
            `SLACKINTERACTIONHANDLER.receiveResetDemo: Volunteer used a shortcut on an invalid message.`
          );
          return;
        }

        if (payload.callback_id === SlackCallbackId.RESET_DEMO) {
          await SlackInteractionHandler.receiveResetDemo({
            payload,
            redisClient,
            modalPrivateMetadata,
            twilioPhoneNumber: redisData ? redisData.twilioPhoneNumber : null,
            userId: MD5.hex(redisData.userPhoneNumber),
            viewId: getViewId(payload, interactivityMetadata),
          });
          return;
        }
        break;
      }
    }
  }

  // If the interaction is confirmation of a modal.
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

  throw new Error(`Received an unexpected Slack interaction.`);
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
