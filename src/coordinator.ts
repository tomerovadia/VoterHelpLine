import Hashes from 'jshashes';

import { EntryPoint, Request, UserInfo, ConstituentStatus, SessionTopics } from './types';
import { TwilioRequestBody } from './twilio_util';
import redisClient from './redis_client';
import * as TwilioUtil from './twilio_util';
import * as LoadBalancer from './load_balancer';
import * as SlackApiUtil from './slack_api_util';
import AgentMessageHandler from './agent_message_handler';
import AgentFeatureHandler from './agent_feature_handler';
import ConstituentMessageHandler from './constituent_message_handler';
import ConstituentCommunicator from './constituent_communicator';
import AgentCommunicator from './agent_communicator';
import logger from './logger';
import * as SlackBlockUtil from './slack_block_util';
import { SlackCallbackId } from './slack_interaction_ids';
import { SlackInteractionEventPayload } from './slack_interaction_handler';
import * as SlackInteractionHandler from './slack_interaction_handler';
import * as Sentry from '@sentry/node';
import { wrapLambdaHandlerForSentry } from './sentry_wrapper';
import DbService from './db_service';
import config from './config';
import { SlackFile } from './message_parser';

export const NUM_STATE_SELECTION_ATTEMPTS_LIMIT = 2;

export type InteractivityHandlerMetadata = { viewId?: string };

export type SlackEventRequestBody = {
  event: {
    type: string;
    hidden: boolean;
    text: string;
    ts: string;
    thread_ts: string;
    user: string;
    channel: string;
    files?: SlackFile[];
  };
  authed_users: string[];
};


export default class Coordinator {
  // Example of storing references to service instances
  //   private slackService: any; // Replace 'any' with the actual type of your Slack service
  //   private twilioService: any; // Replace 'any' with the actual type of your Twilio service
  private constituentMessageHandler: ConstituentMessageHandler;
  private agentMessageHandler: AgentMessageHandler;
  private agentFeatureHandler: AgentFeatureHandler;
  private dbService: DbService;
  private constituentCommunicator: ConstituentCommunicator;
  private agentCommunicator: AgentCommunicator;

  constructor(
    constituentMessageHandler: ConstituentMessageHandler,
    agentMessageHandler: AgentMessageHandler,
    agentFeatureHandler: AgentFeatureHandler,
    dbService: DbService,
    constituentCommunicator: ConstituentCommunicator,
    agentCommunicator: AgentCommunicator
  ) {
    this.constituentMessageHandler = constituentMessageHandler;
    this.agentMessageHandler = agentMessageHandler;
    this.agentFeatureHandler = agentFeatureHandler;
    this.dbService = dbService;
    this.constituentCommunicator = constituentCommunicator;
    this.agentCommunicator = agentCommunicator;
  }

  private BACKGROUND_TASKS = {
    handleIncomingSlackCommand: this.handleIncomingSlackCommand.bind(this),
    handleSlackInteractivity: this.handleSlackInteractivity.bind(this),
    handleIncomingSlackMessageEvent: this.handleIncomingSlackMessageEvent.bind(this),
    handleIncomingSlackAppMentionEvent: this.handleIncomingSlackAppMentionEvent.bind(this)
  };

  /***********************
    SLACK METHODS
  ************************/

  // Method to handle incoming messages from Slack.
  public async handleIncomingSlackMessageEvent(reqBody: SlackEventRequestBody,
    twilioCallbackURL: string,
    {
      retryCount,
      retryReason,
    }: { retryCount: number | undefined; retryReason: string | undefined }): Promise<void> {
    this.agentMessageHandler.handleMessageEvent(
      reqBody,
      twilioCallbackURL,
      {
        retryCount,
        retryReason,
      }
    );
  }

  // Method to handle incoming messages that contain a mention of the Slack app (unofficial Slack commands).
  public async handleIncomingSlackAppMentionEvent(reqBody: SlackEventRequestBody): Promise<void> {
    await this.agentFeatureHandler.handleSlackAppMentionEvent(
      reqBody
    );
  }

  // Method to handle incoming messages that contain Slack commands (official).
  public async handleIncomingSlackCommand(channelId: string,
    channelName: string,
    userId: string,
    userName: string,
    command: string,
    text: string,
    responseUrl: string): Promise<void> {
    await this.agentFeatureHandler.handleSlackCommand(
      channelId, channelName, userId, userName, command, text, responseUrl
    );
  }

  // This wrapper is necessary because agentFeatureHandlerInstance.handleSlackInteractivity
  // can't be listed in BACKGROUND_TASKS directly.
  private async handleSlackInteractivity(
    payload: SlackInteractionEventPayload,
    metadata: InteractivityHandlerMetadata
  ): Promise<void> {
    await this.agentFeatureHandler.handleSlackInteractivity(payload, metadata);
  }

  // Method to handle incoming slack interactivity.
  // This is the only public Slack method of Coordinator that isn't itself meant to be
  // called enqueued as a background task. Instead, it itself enqueues background tasks
  // conditionally based on the type of interactivity.
  public async handleIncomingSlackInteractivity(payload: SlackInteractionEventPayload): Promise<any> {
    let response: any;
    let shouldEnqueueBackgroundTask = true;
    const metadata: InteractivityHandlerMetadata = {};

    if (
      [
        SlackCallbackId.RESET_DEMO,
        SlackCallbackId.MANAGE_ENTRY_POINTS,
        SlackCallbackId.SHOW_NEEDS_ATTENTION,
        SlackCallbackId.ROUTE_TO_JOURNEY,
      ].includes(payload.callback_id as SlackCallbackId)
    ) {
      logger.info(
        `SERVER POST /slack-interactivity: Determined ${payload.callback_id} opens a modal`
      );

      // For certain actions, we always show a modal. Because we have to show
      // this modal within 3 seconds, we immediately make the call to show a
      // loading state, and then pass the modal ID on to the async task to
      // update the modal
      metadata.viewId = await SlackApiUtil.renderModal(
        payload.trigger_id,
        SlackBlockUtil.loadingSlackView()
      );
    }

    if (
      payload.type === 'view_submission' &&
      (payload.view?.callback_id as SlackCallbackId) ===
      SlackCallbackId.MANAGE_ENTRY_POINTS
    ) {
      // Check if we need to render a confirmation modal. This needs to happen
      // synchronously to avoid 3 second timeout.
      const confirmationModal =
        SlackInteractionHandler.maybeGetManageEntryPointsConfirmationModal(
          payload
        );
      if (confirmationModal) {
        logger.info(
          `SERVER POST /slack-interactivity: Determined ${payload.view?.callback_id} pushes a view onto modal`
        );

        response = {
          response_action: 'push',
          view: confirmationModal,
        };

        shouldEnqueueBackgroundTask = false;
      } else {
        logger.info(
          `SERVER POST /slack-interactivity: Determined ${payload.view?.callback_id} updates the view in modal`
        );

        // This will change, so show loading state again.
        response = {
          response_action: 'update',
          view: SlackBlockUtil.loadingSlackView(),
        };
      }
    }

    // On AWS Lambda, returning a response will immediately pause execution. So it's
    // important to enqueue the background task BEFORE responding with anything.
    if (shouldEnqueueBackgroundTask) {
      await this.enqueueBackgroundTask('handleSlackInteractivity', payload, metadata);
    }

    return response;
  }

  /***********************
    TWILIO METHODS
  ************************/

  // Method to handle incoming SMS messages.
  public async handleIncomingSmsMessage(
    req: Request,
    // TODO: Return a status of some kind, instead of void.
    entryPoint: EntryPoint
  ): Promise<void> {
    logger.info('Entering Coordinator.handleIncomingSmsMessage');
    const reqBody = req.body as TwilioRequestBody;
    const inboundDbMessageEntry = this.dbService.populateInitialIncomingConstituentMessageDbEntry({
      userMessage: reqBody.Body,
      userPhoneNumber: reqBody.From,
      twilioPhoneNumber: reqBody.To,
      twilioMessageSid: reqBody.SmsMessageSid,
      twilioAttachments: TwilioUtil.getAttachments(reqBody),
      entryPoint,
    });
    this.constituentMessageHandler.handleMessage(req, entryPoint, inboundDbMessageEntry);
  }

  /***********************
    INFRA METHODS
  ************************/

  /**
 * Slack requires that you respond to webhooks within 3 seconds. So when
 * responding to Slack webhooks, we kick off a background job and then respond
 * immediately with a 200.
 *
 * How we run background tasks depends on how we're deployed. By default, we
 * just run the task in the background. On Lambda, we instead invoke the
 * worker Lambda function (which runs this same codebase) asynchronously.
 */
  public async enqueueBackgroundTask(
    // These type declarations are a bit complicated -- basically, this is saying
    // that `taskName` must be one of the keys of BACKGROUND_TASKS, and that
    // `args` must match the arguments of that function
    taskName: keyof typeof this.BACKGROUND_TASKS,
    ...args: Parameters<(typeof this.BACKGROUND_TASKS)[typeof taskName]>
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
      this.BACKGROUND_TASKS[taskName](...args).catch((err) => {
        logger.error(err);
        Sentry.captureException(err);
      });
    }
  }

  public backgroundLambdaHandler = wrapLambdaHandlerForSentry(
    async (event: any): Promise<void> => {
      logger.info(
        `Running Lambda background function with payload: ${JSON.stringify(
          event
        )}`
      );

      const { taskName, args } = event;

      if (!(taskName in this.BACKGROUND_TASKS)) {
        throw new Error(`Got an invalid task name: ${taskName}`);
      }

      // @ts-ignore Typescript can't check this -- everything's coming in from the
      // dynamic payload
      await BACKGROUND_TASKS[taskName](...args);
    }
  );
}

// TODO: Update this to allow constructors to take arguments. See discussion "JS AWS Lambda + Constructor Use."
// Used by serverless.yml.
// const agentFeatureHandlerInstance = new AgentFeatureHandler();
// const constituentManagementServiceInstance = new ConstituentManagementService();
// const dbServiceInstance = new DbService();
// const CoordinatorInstance = new Coordinator(constituentManagementServiceInstance, agentFeatureHandlerInstance, dbServiceInstance);
// module.exports.backgroundLambdaHandler = CoordinatorInstance.backgroundLambdaHandler.bind(CoordinatorInstance);
