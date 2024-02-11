import * as Sentry from '@sentry/node';

import { UserInfo } from './types';
import * as DbApiUtil from './db_api_util';
import redisClient from './redis_client';
import * as KeywordParser from './keyword_parser';
import * as SlackInteractionApiUtil from './slack_interaction_api_util';
import * as RedisApiUtil from './redis_api_util';
import * as SlackApiUtil from './slack_api_util';
import logger from './logger';

export default class ConstituentManagementService {
  private Constituent: any; // Stores constituents in memory

  constructor() {
    // Constructor can be used to initialize the service with predefined data
  }

  async handleKnownVoterBlockLogic(
    userInfo: UserInfo,
    userMessage: string,
    userPhoneNumber: string,
    twilioPhoneNumber: string,
    inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry
  ): Promise<boolean> {
    logger.debug('ENTERING SERVER');
    // Outbound texts should be blocked if either:
    // 1. this current message is STOP, or
    // 2. a prior interaction set outbound texts to be blocked for this user.
    let outboundTextsBlocked = await RedisApiUtil.getHashField(
      redisClient,
      'slackBlockedUserPhoneNumbers',
      userPhoneNumber
    );

    if (KeywordParser.isStopKeyword(userMessage)) {
      logger.info(
        `SERVER.handleIncomingTwilioMessage: Received STOP text from phone number: ${userPhoneNumber}.`
      );
      // Check is necessary in case a previously seen voter doesn't have a Slack thread
      // and their 2nd+ message is STOP, in which case there's nothing to collapse.
      if ('activeChannelId' in userInfo) {
        // This function also handles adding the phone number to blocklists.
        await SlackInteractionApiUtil.handleAutomatedCollapseOfVoterStatusPanel(
          {
            userInfo,
            redisClient,
            newVoterStatus: 'REFUSED',
            userPhoneNumber,
            twilioPhoneNumber,
          }
        );
      } else {
        await RedisApiUtil.setHash(
          redisClient,
          'slackBlockedUserPhoneNumbers',
          {
            [userPhoneNumber]: '1',
          }
        );
      }
      outboundTextsBlocked = true;

      // Update thread needs attention status -> false
      await DbApiUtil.setThreadNeedsAttentionToDb(
        userInfo[userInfo.activeChannelId],
        userInfo.activeChannelId,
        false
      );
    }

    // If outbound texts are prohibited to this user, we return --
    // but first, we relay the message to Slack if a thread exists for
    // this voter and we write to the DB.
    if (outboundTextsBlocked) {
      DbApiUtil.updateDbMessageEntryWithUserInfo(
        userInfo!,
        inboundDbMessageEntry
      );

      if ('activeChannelId' in userInfo) {
        // This includes a DB write of the message.
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
      } else {
        // The message isn't being relayed, so don't fill this field in Postgres.
        inboundDbMessageEntry.successfullySent = null;
        try {
          await DbApiUtil.logMessageToDb(inboundDbMessageEntry);
        } catch (error) {
          logger.info(
            `SERVER.handleIncomingTwilioMessage: failed to log incoming voter message to DB`
          );
          Sentry.captureException(error);
        }
      }
    }
    return outboundTextsBlocked;
  }
}
