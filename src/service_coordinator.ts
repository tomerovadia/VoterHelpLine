import Hashes from 'jshashes';

import { EntryPoint, Request, UserInfo } from './types';
import { TwilioRequestBody } from './twilio_util';
import * as RedisApiUtil from './redis_api_util';
import redisClient from './redis_client';
import * as TwilioUtil from './twilio_util';
import * as TwilioApiUtil from './twilio_api_util';
import * as DbApiUtil from './db_api_util';
import * as LoadBalancer from './load_balancer';
import * as Router from './router';
import * as KeywordParser from './keyword_parser';
import * as SlackApiUtil from './slack_api_util';
import * as MessageConstants from './message_constants';
import ConstituentManagementService  from './constituent_management_service';
import logger from './logger';

export default class ServiceCoordinator {
  // Example of storing references to service instances
//   private slackService: any; // Replace 'any' with the actual type of your Slack service
//   private twilioService: any; // Replace 'any' with the actual type of your Twilio service
  private constituentManagementService: ConstituentManagementService; // Replace 'any' with the actual type of your constituent management service
//   private agentManagementService: any; // Replace 'any' with the actual type of your agent management service

  constructor(
    constituentManagementService: ConstituentManagementService,
    // agentManagementService: any,
    // slackService: any,
    // twilioService: any
  ) {
    this.constituentManagementService = constituentManagementService;
    // this.agentManagementService = agentManagementService;
    // this.slackService = slackService;
    // this.twilioService = twilioService;
  }

  // Method to handle incoming messages from Slack
  public handleIncomingSlackMessage(message: string): void {
    console.log(`Handling Slack message: ${message}`);
    // Implement logic to process the Slack message here
    // This might include calling the Twilio service to send an SMS, etc.
  }

  // Method to handle incoming SMS messages from Twilio
  public async handleIncomingTwilioMessage(
    req: Request,
    // TODO: Return a status of some kind, instead of void.
    entryPoint: EntryPoint
  ): Promise<void> {
    logger.info('Entering SERVER.handleIncomingTwilioMessage');

    const reqBody = req.body as TwilioRequestBody;
    const userPhoneNumber = reqBody.From;

    const inboundTextsBlocked = await RedisApiUtil.getHashField(
      redisClient,
      'twilioBlockedUserPhoneNumbers',
      userPhoneNumber
    );

    if (inboundTextsBlocked === '1') {
      logger.info(
        `SERVER.handleIncomingTwilioMessage: Received text from blocked phone number: ${userPhoneNumber}.`
      );
      return;
    }

    const twilioPhoneNumber = reqBody.To;
    const userMessage = reqBody.Body;
    const userAttachments = TwilioUtil.getAttachments(reqBody);
    const MD5 = new Hashes.MD5();
    const userId = MD5.hex(userPhoneNumber);
    logger.info(`SERVER.handleIncomingTwilioMessage: Receiving Twilio message from ${entryPoint} entry point voter,
                          userPhoneNumber: ${userPhoneNumber},
                          twilioPhoneNumber: ${twilioPhoneNumber},
                          userMessage: ${userMessage},
                          userId: ${userId}`);

    const inboundDbMessageEntry =
      DbApiUtil.populateIncomingDbMessageTwilioEntry({
        userMessage,
        userPhoneNumber,
        twilioPhoneNumber,
        twilioMessageSid: reqBody.SmsMessageSid,
        twilioAttachments: userAttachments,
        entryPoint: LoadBalancer.PUSH_ENTRY_POINT,
      });

    const redisHashKey = `${userId}:${twilioPhoneNumber}`;

    logger.info(
      `SERVER.handleIncomingTwilioMessage (${userId}): Retrieving userInfo using redisHashKey: ${redisHashKey}`
    );

    let userInfo = (await RedisApiUtil.getHash(
      redisClient,
      redisHashKey
    )) as UserInfo | null;
    logger.info(
      `SERVER.handleIncomingTwilioMessage (${userId}): Successfully received Redis response for userInfo retrieval with redisHashKey ${redisHashKey}, userInfo: ${JSON.stringify(
        userInfo
      )}`
    );

    // New session?
    let returningVoter = false;
    if (userInfo && Router.isStaleSession(userInfo)) {
      logger.info(
        `SERVER.handleIncomingTwilioMessage (${userId}): no sessionStartEpoch, starting with fresh userInfo`
      );
      await Router.endVoterSession(redisClient, userInfo, twilioPhoneNumber);
      userInfo = null;
      returningVoter = true;
    }

    const twilioCallbackURL = TwilioUtil.twilioCallbackURL(req);

    // Rejoin?
    if (KeywordParser.isJoinKeyword(userMessage)) {
      const outboundTextsBlocked = await RedisApiUtil.getHashField(
        redisClient,
        'slackBlockedUserPhoneNumbers',
        userPhoneNumber
      );
      if (outboundTextsBlocked) {
        logger.info(
          `SERVER.handleIncomingTwilioMessage: Received JOIN from refused phone number: ${userPhoneNumber}, unblocking.`
        );
        // Start allowing texts to this voter
        await RedisApiUtil.deleteHashField(
          redisClient,
          'slackBlockedUserPhoneNumbers',
          userPhoneNumber
        );
        const MD5 = new Hashes.MD5();
        await DbApiUtil.logRejoinStatusToDb(
          MD5.hex(userPhoneNumber),
          userPhoneNumber,
          twilioPhoneNumber,
          LoadBalancer.phoneNumbersAreDemo(twilioPhoneNumber, userPhoneNumber)
        );
        if (userInfo) {
          // Treat this as a new session
          await Router.endVoterSession(
            redisClient,
            userInfo,
            twilioPhoneNumber
          );
          userInfo = null;
          returningVoter = true;
        }
      }
    } else if (
      (process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA' ||
        process.env.CLIENT_ORGANIZATION === 'GADEMS') &&
      KeywordParser.isHelplineKeyword(userMessage)
    ) {
      // If the voter has previously opted out and then texts HELPLINE, instruct
      // them to JOIN.
      const outboundTextsBlocked = await RedisApiUtil.getHashField(
        redisClient,
        'slackBlockedUserPhoneNumbers',
        userPhoneNumber
      );
      if (outboundTextsBlocked) {
        if (!userInfo) {
          // Voters that have opted out should always have a residual userInfo.  However,
          // provide this (somewhat kludgey) fallback so that they still get the message just
          // in case they don't.
          logger.info(
            `SERVER.handleIncomingTwilioMessage: Received HELPLINE on refused phone number ${userPhoneNumber}; creating missing UserInfo`
          );
          const userOptions = {
            userPhoneNumber,
            userMessage,
            userAttachments,
            userId,
          };
          userInfo = Router.prepareUserInfoForNewVoter({
            userOptions,
            twilioPhoneNumber,
            entryPoint,
            returningVoter,
          });
        }
        logger.info(
          `SERVER.handleIncomingTwilioMessage: Received HELPLINE on refused phone number ${userPhoneNumber}; instructing them to re-JOIN`
        );
        // Log incoming message
        await SlackApiUtil.sendMessage(
          userMessage,
          {
            parentMessageTs: userInfo[userInfo.activeChannelId],
            channel: userInfo.activeChannelId,
            isVoterMessage: true,
          },
          inboundDbMessageEntry,
          userInfo
        );
        // Reply
        const replyMessage = MessageConstants.HELPLINE_AFTER_STOP_RESPONSE();
        await TwilioApiUtil.sendMessage(
          replyMessage,
          {
            userPhoneNumber: userPhoneNumber,
            twilioPhoneNumber,
            twilioCallbackURL,
          },
          DbApiUtil.populateAutomatedDbMessageEntry(userInfo)
        );
        await SlackApiUtil.sendMessage(replyMessage, {
          parentMessageTs: userInfo[userInfo.activeChannelId],
          channel: userInfo.activeChannelId,
          isAutomatedMessage: true,
        });
        return;
      }
    }

    // Seen this voter before
    if (userInfo != null) {
      logger.info(
        `SERVER.handleIncomingTwilioMessage (${userId}): Voter is known to us (Redis returned userInfo for redisHashKey ${redisHashKey})`
      );

      const outboundTextsBlocked = await this.constituentManagementService.handleKnownVoterBlockLogic(
        userInfo,
        userMessage,
        userPhoneNumber,
        twilioPhoneNumber,
        inboundDbMessageEntry
      );
      if (outboundTextsBlocked) return;

      // Voter is known but has no Slack thread.
      // Context: Certain organizations require an extra step before a Slack
      // thread is created for a voter. In these cases we still record whether
      // we've seen voters, but we may not have an active channel for them.
      if (!('activeChannelId' in userInfo)) {
        logger.info(
          `SERVER.handleIncomingTwilioMessage (${userId}): Voter is known but doesn't have a Slack thread yet.`
        );
        if (
          process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA' ||
          process.env.CLIENT_ORGANIZATION === 'GADEMS'
        ) {
          const userMessageNoPunctuation = userMessage
            .toLowerCase()
            .replace(/[^a-zA-Z]/g, '');
          if (
            userMessageNoPunctuation.startsWith('helpline') ||
            (process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA' &&
              Router.parseStateKeyword(redisClient, userInfo, userMessage))
          ) {
            await Router.handleNewVoter(
              userInfo,
              { userPhoneNumber, userMessage, userAttachments, userId },
              redisClient,
              twilioPhoneNumber,
              inboundDbMessageEntry,
              entryPoint,
              twilioCallbackURL,
              false /* includeWelcome */
            );
            return;
          } else {
            await Router.clarifyHelplineRequest(
              { userInfo, userPhoneNumber, userAttachments, userMessage },
              redisClient,
              twilioPhoneNumber,
              inboundDbMessageEntry,
              twilioCallbackURL
            );
            return;
          }
        } else {
          // For other organizations, all known and unblocked voters should have a Slack thread.
          throw new Error(
            `Redis has a userInfo that unexpectedly doesn't have an activeChannelId (userId: ${userId}, twilioPhoneNumber: ${twilioPhoneNumber})`
          );
        }
      }

      // PUSH
      if (entryPoint === LoadBalancer.PUSH_ENTRY_POINT) {
        logger.info(
          `SERVER.handleIncomingTwilioMessage (${userId}): Skipping automated system since entrypoint is ${LoadBalancer.PUSH_ENTRY_POINT}.`
        );
        // Don't do dislcaimer or U.S. state checks for push voters.
        await Router.handleClearedVoter(
          { userInfo, userAttachments, userPhoneNumber, userMessage },
          redisClient,
          twilioPhoneNumber,
          inboundDbMessageEntry,
          twilioCallbackURL
        );
        // PULL
      } else if (
        userInfo.confirmedDisclaimer ||
        process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA' ||
        process.env.CLIENT_ORGANIZATION === 'GADEMS'
      ) {
        logger.info(
          `SERVER.handleIncomingTwilioMessage (${userId}): Activating automated system since entrypoint is ${LoadBalancer.PULL_ENTRY_POINT}.`
        );
        logger.info(
          `SERVER.handleIncomingTwilioMessage (${userId}): Voter has previously confirmed the disclaimer, or one is not required for this organization.`
        );

        // Always update the status if user texts VOTED, regardless of what mode
        // we are in below.
        if (
          process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA' &&
          KeywordParser.isVotedKeyword(userMessage)
        ) {
          await Router.recordVotedStatus(userInfo, twilioPhoneNumber);
        }

        // Voter has a state determined. The U.S. state name is used for
        // operator messages as well as to know whether a U.S. state is known
        // for the voter. This may not be ideal (create separate bool?).
        // Turn off automated replies if:
        // 1. a volunteer has intervened, or
        // 2. we've asked for their U.S. state too many times.
        if (
          userInfo.stateName ||
          userInfo.volunteerEngaged ||
          userInfo.numStateSelectionAttempts >=
            Router.NUM_STATE_SELECTION_ATTEMPTS_LIMIT
        ) {
          logger.info(
            `SERVER.handleIncomingTwilioMessage (${userId}): Known U.S. state for voter (${userInfo.stateName}) or volunteer has engaged (${userInfo.volunteerEngaged}). Automated system no longer active.`
          );
          await Router.handleClearedVoter(
            { userInfo, userPhoneNumber, userMessage, userAttachments },
            redisClient,
            twilioPhoneNumber,
            inboundDbMessageEntry,
            twilioCallbackURL
          );
          // Voter texted VOTED during the state determination
        } else if (
          process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA' &&
          KeywordParser.isVotedKeyword(userMessage)
        ) {
          await Router.replyToVoted(
            userInfo,
            twilioPhoneNumber,
            twilioCallbackURL,
            userMessage,
            inboundDbMessageEntry
          );
          // Voter has no state determined
        } else {
          logger.info(
            `SERVER.handleIncomingTwilioMessage (${userId}): U.S. state for voter is not known. Automated system will attempt to determine.`
          );
          await Router.determineVoterState(
            { userInfo, userPhoneNumber, userMessage, userAttachments },
            redisClient,
            twilioPhoneNumber,
            inboundDbMessageEntry,
            twilioCallbackURL
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
          { userInfo, userPhoneNumber, userMessage, userAttachments },
          redisClient,
          twilioPhoneNumber,
          inboundDbMessageEntry,
          twilioCallbackURL
        );
      }
      // This is the first time we're seeing this voter.
    } else {
      logger.info(
        `SERVER.handleIncomingTwilioMessage (${userId}): Voter is new to us (Redis returned no userInfo for redisHashKey ${redisHashKey})`
      );

      if (KeywordParser.isStopKeyword(userMessage)) {
        logger.info(
          `SERVER.handleIncomingTwilioMessage: Received STOP text from phone number: ${userPhoneNumber}.`
        );
        // Block volunteers or automated system from sending messages to this number in the future,
        // even though there is no thread from which volunteers could do so.
        await RedisApiUtil.setHash(
          redisClient,
          'slackBlockedUserPhoneNumbers',
          {
            [userPhoneNumber]: '1',
          }
        );
        // If the voter's first messsage to us is STOP, ignore any and all subsequent messages.
        await RedisApiUtil.setHash(
          redisClient,
          'twilioBlockedUserPhoneNumbers',
          {
            [userPhoneNumber]: '1',
          }
        );
        // Return so that there is no logging in PG, no Slack thread is created, and
        // no automated response is sent to the voter.
        return;
      }

      const userOptions = {
        userPhoneNumber,
        userMessage,
        userAttachments,
        userId,
      };
      const userInfo = Router.prepareUserInfoForNewVoter({
        userOptions,
        twilioPhoneNumber,
        entryPoint,
        returningVoter,
      });

      if (
        process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA' ||
        process.env.CLIENT_ORGANIZATION === 'GADEMS'
      ) {
        if (
          KeywordParser.isHelplineKeyword(userMessage) ||
          (process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA' &&
            Router.parseStateKeyword(redisClient, userInfo, userMessage))
        ) {
          await Router.handleNewVoter(
            userInfo,
            userOptions,
            redisClient,
            twilioPhoneNumber,
            inboundDbMessageEntry,
            entryPoint,
            twilioCallbackURL,
            true /* includeWelcome */
          );
        } else {
          await Router.welcomePotentialVoter(
            userInfo,
            userOptions,
            redisClient,
            twilioPhoneNumber,
            inboundDbMessageEntry,
            entryPoint,
            twilioCallbackURL
          );
        }
      } else {
        await Router.handleNewVoter(
          userInfo,
          userOptions,
          redisClient,
          twilioPhoneNumber,
          inboundDbMessageEntry,
          entryPoint,
          twilioCallbackURL
        );
      }
    }
  }

  // Add more methods as needed to facilitate communication and coordination between services
}

// // Example instantiation and usage
// const slackServiceInstance = {}; // Replace with actual Slack service instance
// const twilioServiceInstance = {}; // Replace with actual Twilio service instance

// const coordinator = new ServiceCoordinator(slackServiceInstance, twilioServiceInstance);

// coordinator.handleSlackMessage("Example Slack message");
// coordinator.handleTwilioSMS("Example Twilio SMS");
