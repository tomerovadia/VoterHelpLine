import * as Sentry from '@sentry/node';

import { ConstituentStatus, UserInfo, EntryPoint } from './types';
import * as DbApiUtil from './db_api_util';
import redisClient from './redis_client';
import * as KeywordParser from './keyword_parser';
import * as SlackInteractionApiUtil from './slack_interaction_api_util';
import * as RedisApiUtil from './redis_api_util';
import * as SlackApiUtil from './slack_api_util';
import logger from './logger';
import Constituent from './constituent';
import config from './config';
import * as MessageConstants from './message_constants';
import * as Router from './router';
import * as TwilioApiUtil2 from './twilio_api_util_refactored';
import * as TwilioApiUtil from './twilio_api_util';
import * as LoadBalancer from './load_balancer';
import * as StateParser from './state_parser';

export default class ConstituentManagementService {
  private constituent: Constituent;
  private userAttachments: string[];
  private twilioPhoneNumber: string;
  private twilioCallbackUrl: string;
  private inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry | undefined;
  private entryPoint: EntryPoint;

  constructor() {
    this.constituent = {
      info: undefined,
      status: ConstituentStatus.UNKNOWN,
      id: '',
      phoneNumber: '',
      onOptOutList: false,
      message: undefined,
      known: undefined,
    };
    this.userAttachments = [];
    this.twilioPhoneNumber = '';
    this.twilioCallbackUrl = '';
    this.inboundDbMessageEntry = undefined;
    this.entryPoint = 'UNKNOWN';
  }

  public setConstituentId(constituentId: string): void {
    this.constituent.id = constituentId;
  }

  public setConstituentPhoneNumber(phoneNumber: string) {
    this.constituent.phoneNumber = phoneNumber;
  }

  public setConstituentMessage(message: string): void {
    this.constituent.message = message;
  }

  public setUserAttachments(userAttachments: string[]): void {
    this.userAttachments = userAttachments;
  }

  public setTwilioPhoneNumber(twilioPhoneNumber: string): void {
    this.twilioPhoneNumber = twilioPhoneNumber;
  }

  public setTwilioCallbackURL(twilioCallbackUrl: string): void {
    this.twilioCallbackUrl = twilioCallbackUrl;
  }

  public setInboundDbMessageEntry(inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry): void {
    this.inboundDbMessageEntry = inboundDbMessageEntry;
  }

  public setEntryPoint(entryPoint: EntryPoint): void {
    this.entryPoint = entryPoint;
  }

  public getConstituentStatus(): ConstituentStatus {
    console.log('getConstituentStatus this.constituent.status: ', this.constituent.status);
    return this.constituent.status;
  }

  public getConstituentStateName(): string | null {
    return this.constituent.info ? this.constituent.info.stateName : null;
  }

  public isConstituentKnown(): boolean {
    return this.constituent.known ? this.constituent.known : false;
  }

  public async fetchAndLoadKnownState(): Promise<string | null> {
    const knownState = await DbApiUtil.getKnownPhoneState(
      this.constituent.phoneNumber
    );
    if (knownState) {
      // The knownState value from the db is probably a state abbreviation, so we need to resolve it
      const stateName = StateParser.determineState(knownState);
      if (stateName && this.constituent.info) {
        // Success: we know the state
        this.constituent.info.stateName = stateName;
        this.constituent.info.panelmessage = 'known phone number';

        // TODO: Move this logic to another function that is responsible for
        // selecting a Slack channel under any conditions.
        let slackChannelName = await LoadBalancer.selectSlackChannel(
          redisClient,
          LoadBalancer.PULL_ENTRY_POINT,
          this.constituent.info.stateName,
          this.constituent.info.isDemo
        );
        if (slackChannelName) {
          return slackChannelName;
        }
      } else {
        logger.warning(
          `ConstituentManagementService.fetchAndLoadKnownState (${this.constituent.id}): unable to parse known state '${knownState}`
        );
        return null;
      }
    }

    return null;
  }

  public getOnOptOutList(): boolean {
    return this.constituent.onOptOutList;
  }

  public async fetchAndLoadConstituentInfo(
    twilioPhoneNumber: string
  ): Promise<UserInfo | null> {
    const redisHashKey = `${this.constituent.id}:${twilioPhoneNumber}`;

    logger.info(
      `ConstituentManagementService.fetchAndLoadConstituentInfo (${this.constituent.id}): Retrieving userInfo using redisHashKey: ${redisHashKey}`
    );

    // If not using Redis, replace this with a different database call.
    this.constituent.info = (await RedisApiUtil.getHash(
      redisClient,
      redisHashKey
    )) as UserInfo | null;

    logger.info(
      `ConstituentManagementService.determineConstituentStatus (${this.constituent.id}): Successfully received Redis response with userInfo: ${JSON.stringify(
        this.constituent.info
      )}`);

    this.constituent.known = this.constituent.info ? true : false;

    return this.constituent.info;
  }

  public loadInfoForNewConstituent({
    userPhoneNumber,
    constituentId,
    twilioPhoneNumber,
    entryPoint,
  }: {
    userPhoneNumber: string;
    constituentId: string;
    twilioPhoneNumber: string;
    entryPoint: EntryPoint;
  }): UserInfo {
    let isDemo, confirmedDisclaimer, volunteerEngaged;
    if (entryPoint === LoadBalancer.PULL_ENTRY_POINT) {
      isDemo = LoadBalancer.phoneNumbersAreDemo(
        twilioPhoneNumber,
        userPhoneNumber
      );
      logger.debug(
        `ConstituentManagementService.loadInfoForNewConstituent (${constituentId}): Evaluating isDemo based on userPhoneNumber/twilioPhoneNumber: ${isDemo}`
      );
      confirmedDisclaimer = false;
      volunteerEngaged = false;
    }

    const userInfo = {
      userId: constituentId,
      twilioPhoneNumber: twilioPhoneNumber,
      // Necessary for admin controls, so userPhoneNumber can be found even though
      // admins specify only userId.
      userPhoneNumber: userPhoneNumber,
      isDemo,
      confirmedDisclaimer,
      volunteerEngaged,
      lastVoterMessageSecsFromEpoch: Math.round(Date.now() / 1000),
      // Not necessary except for DB logging purposes. The twilioPhoneNumber reveals
      // the entry point. But to log for automated messages and Slack-to-Twilio
      // messages, this is necessary.
      entryPoint,
      numStateSelectionAttempts: 0,
      // Start time for this session, with a bit of slop to capture the first message
      sessionStartEpoch: Math.round(Date.now() / 1000) - 10,
    } as UserInfo;

    this.constituent.info = userInfo;

    return userInfo;
  }

  public async fetchAndLoadOptOutStatus(): Promise<void> {
    // TODO: Rename slackBlockedUserPhoneNumbers to something like 'optedOutPhoneNumbers'
    this.constituent.onOptOutList = await RedisApiUtil.getHashField(
      redisClient,
      'slackBlockedUserPhoneNumbers',
      this.constituent.phoneNumber,
    );
  }

  public async sendMessageToConstituent({
    message,
    media,
    deduplicationId,
    automated
  }: {
    message: string;
    media?: string[];
    deduplicationId?: string;
    automated: boolean
  }
  ): Promise<void> {
    logger.info(`ENTERING ConstituentManagementService.sendMessageToConstituent`);
    // TODO: Might need to initialize an object here for starters.
    let databaseMessageEntry;
    if (automated) {
      databaseMessageEntry = DbApiUtil.populateAutomatedDbMessageEntry(this.constituent.info!);
    } else {
      // TODO: Change this once I come upon the human message send path.
      databaseMessageEntry = DbApiUtil.populateAutomatedDbMessageEntry(this.constituent.info!);
    }
    
    databaseMessageEntry.message = message;
    databaseMessageEntry.fromPhoneNumber = this.twilioPhoneNumber;
    databaseMessageEntry.toPhoneNumber = this.constituent.phoneNumber;
    databaseMessageEntry.twilioSendTimestamp = new Date();

    logger.info(
      `TWILIOAPIUTIL.sendMessage: Including attachments ${JSON.stringify(
        media
      )}`
    );

    const twilioSendMessageResponse = await TwilioApiUtil2.sendMessage(message, media, {
      deduplicationId,
      twilioPhoneNumber: this.twilioPhoneNumber,
      userPhoneNumber: this.constituent.phoneNumber,
      twilioCallbackURL: this.twilioCallbackUrl,
    });

    if (twilioSendMessageResponse && twilioSendMessageResponse.success) {
      databaseMessageEntry.successfullySent = true;
      databaseMessageEntry.twilioMessageSid = twilioSendMessageResponse.sid;
    } else {
      const twilioError = twilioSendMessageResponse.error;
      const twilioErrorMessage = !twilioError ? '' : `Status: ${
        'status' in twilioError ? twilioError.status : ''
      }, Message:${'message' in twilioError ? twilioError.message : ''}, Code: ${
        'code' in twilioError ? twilioError.code : ''
      }, More Info: ${'more_info' in twilioError ? twilioError.more_info : ''}`;
      logger.error(
        `TWILIOAPIUTIL.sendMessage: ERROR in sending Twilio message. Error data from Twilio: ${twilioErrorMessage}`
      );

      databaseMessageEntry.successfullySent = false;

      if (twilioSendMessageResponse.errorMessage == 'helpline_deduplication_filtered') {
        // TODO: Modify this to not use the db entry, which should only be for db purposes.
        logger.warn(
          'ConstituentManagementService.sendMessageToConstituent: Not sending duplicate Twilio message ' +
            `triggered by Slack message ${databaseMessageEntry.slackMessageTs} in ` +
            `channel ${databaseMessageEntry.slackChannel} to ${this.constituent.phoneNumber}: ${message}`
        );
      }
      databaseMessageEntry.twilioError = twilioErrorMessage ? twilioErrorMessage : twilioSendMessageResponse.errorMessage;
    }

    try {
      // TODO: Use dbService for this intead.
      await DbApiUtil.logMessageToDb(databaseMessageEntry);
    } catch (error) {
      logger.error(
        'ConstituentManagementService.sendMessageToConstituent: failed to log message send to DB'
      );
      Sentry.captureException(error);
    }
  }

  // Method defining the logic for determining if a user is a returning constituent.
  // Clients should define their own logic here, if using this feature.
  private isConstituentReturningFromPreviousCycle(): boolean {
    // This is a reference, necessary to avoid typescript errors.
    let constituentInfo = this.constituent.info;
    if (!constituentInfo) {
      return false;
    }

    if (!constituentInfo.sessionStartEpoch) {
      // legacy session from before 2020-11-03 election
      return true;
    }
  
    if (
      process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA' &&
      constituentInfo.sessionStartEpoch < 1611775722 // Jan 27, 2021 -- VA moved all voters back to national-0
    ) {
      return true;
    }
  
    // add other "stale" logic here (e.g., session is idle for >2 months)
    // ...
  
    return false;
  }

  // Method to be called when a user is returning from a previous cycle.
  public handleReturningConstituent() {
    this.constituent.info = null;
  }

  public async handleHelplineFromOptedOutConstituent() {
    if (!this.constituent.message || !this.inboundDbMessageEntry) {
      logger.error(
        `Unexpected error: ConstituentManagementService.handleHelplineFromOptedOutConstituent: this.constituent.message and/or this.inboundDbMessageEntry are undefined.`
      );
      return;
    }

    // If the voter has previously opted out and then texts HELPLINE, instruct
    // them to JOIN.
    const outboundTextsBlocked = await RedisApiUtil.getHashField(
      redisClient,
      'slackBlockedUserPhoneNumbers',
      this.constituent.phoneNumber
    );
    if (outboundTextsBlocked) {
      if (!this.constituent.info) {
        // Voters that have opted out should always have a residual userInfo.  However,
        // provide this (somewhat kludgey) fallback so that they still get the message just
        // in case they don't.
        logger.info(
          `ConstituentManagementService.handleHelplineFromOptedOutConstituent: Received HELPLINE on refused phone number ${this.constituent.phoneNumber}; creating missing UserInfo`
        );
        const userOptions = {
          userPhoneNumber: this.constituent.phoneNumber,
          userMessage: this.constituent.message,
          userAttachments: this.userAttachments,
          userId: this.constituent.id,
        };
        this.constituent.info = Router.prepareUserInfoForNewVoter({
          userOptions,
          twilioPhoneNumber: this.twilioPhoneNumber,
          entryPoint: this.entryPoint,
          // TODO: Confirm that this is the right value. This was carried over from refactor. Ideally, deprecate this field.
          returningVoter: false,
        });
      }
      logger.info(
        `ConstituentManagementService.handleHelplineFromOptedOutConstituent: Received HELPLINE on refused phone number ${this.constituent.phoneNumber}; instructing them to re-JOIN`
      );

      if (!this.constituent.info || !this.constituent.message) {
        logger.error(
          `Unexpected error: ConstituentManagementService.handleHelplineFromOptedOutConstituent: this.constituent.info and/or this.constituent.message are undefined.`
        );
        return;
      }
      // Log incoming message
      await SlackApiUtil.sendMessage(
        this.constituent.message,
        {
          parentMessageTs: this.constituent.info[this.constituent.info.activeChannelId],
          channel: this.constituent.info.activeChannelId,
          isVoterMessage: true,
        },
        this.inboundDbMessageEntry,
        this.constituent.info
      );
      // Reply
      const replyMessage = MessageConstants.HELPLINE_AFTER_STOP_RESPONSE();
      await TwilioApiUtil.sendMessage(
        replyMessage,
        {
          userPhoneNumber: this.constituent.info.phoneNumber,
          twilioPhoneNumber: this.twilioPhoneNumber,
          twilioCallbackURL: this.twilioCallbackUrl,
        },
        DbApiUtil.populateAutomatedDbMessageEntry(this.constituent.info)
      );
      await SlackApiUtil.sendMessage(replyMessage, {
        parentMessageTs: this.constituent.info[this.constituent.info.activeChannelId],
        channel: this.constituent.info.activeChannelId,
        isAutomatedMessage: true,
      });
      return;
    }
  }

  // Method containing high-level logic for the general approach to be used
  // for an incoming constituent message.
  public determineConstituentStatus(): void {
    const constituentId = this.constituent.id;
    if (this.constituent.known) {
        if ('activeChannelId' in this.constituent.info!) {
          if (config.enableMultiCycleFeature && this.isConstituentReturningFromPreviousCycle()) {
            // TODO: Add helper function to make these logs briefer, e.g. by prepending the location.
            logger.info(
              `ConstituentManagementService.determineConstituentStatus (${constituentId}): determined that voter is returning from a previous cycle, starting with fresh userInfo`
            );
            this.constituent.info.returningVoter = true;
            this.constituent.status = ConstituentStatus.RETURNING;
          } else if (this.constituent.known && 'activeChannelId' in this.constituent.info) {
            if (this.constituent.info.stateName ||
              this.constituent.info.volunteerEngaged ||
              this.constituent.info.numStateSelectionAttempts >=
              config.numStateSelectionAttemptsLimit) {
                this.constituent.status = ConstituentStatus.HAS_ENTERED_CONVERSATION;
              } else {
                this.constituent.status = ConstituentStatus.HAS_ENTERED_AUTOMATED;
              }
          }
        } else if (this.constituent.message && KeywordParser.isHelplineKeyword(this.constituent.message)) {
          this.constituent.status = ConstituentStatus.ENTERING;
        } else {
          this.constituent.status = ConstituentStatus.PRE_ENTERING_AUTOMATED;
        }
    } else {
      logger.info(
        `ConstituentManagementService.determineConstituentStatus (${constituentId}): No existing userInfo for user after Redis retrieval with redisHashKey ${`${constituentId}:${this.twilioPhoneNumber}`}`);
        if (this.constituent.message && KeywordParser.isHelplineKeyword(this.constituent.message)) {
          // TODO: We might need a special message for constituents who are messaging for the very first
          // time and their message is HELPLINE. Rather than "ok..." we should have a bit of a welcome.
          this.constituent.status = ConstituentStatus.ENTERING;
        } else {
          this.constituent.status = ConstituentStatus.NEW;
        }
    }
  }

  // Method to handle opted out constituent logic, whether they have opted
  // out in the past or are opting out now, or are now opting back in.
  public async handleOptOutLogic(twilioPhoneNumber: string, inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry): Promise<boolean> {
    if (!this.constituent.message) {
      // Add an error message here.
      return false;
    }
    const constituentMessageIsOptOut = KeywordParser.isStopKeyword(this.constituent.message);
    if (!constituentMessageIsOptOut && !this.constituent.onOptOutList) {
        return true;
    }

    // We need to check if they're already on the list first, to avoid trying
    // to collapse an already-collapsed thread, etc.
    if (this.constituent.onOptOutList) {
      // Constituent is now wanting to rejoin.
      if (KeywordParser.isJoinKeyword(this.constituent.message)) {
        logger.info(
          `ConstituentManagementService.handleOptOutLogic: Received JOIN from refused phone number: ${this.constituent.phoneNumber}, unblocking.`
        );
        await RedisApiUtil.deleteHashField(
          redisClient,
          'slackBlockedUserPhoneNumbers',
          this.constituent.phoneNumber
        );
        if (this.constituent.status in [ConstituentStatus.HAS_ENTERED_AUTOMATED, ConstituentStatus.HAS_ENTERED_CONVERSATION]) {
          // TODO: Need logic here to re-open the Slack thread with the voter, if one exists.
        }
        if (this.constituent.info) this.constituent.info.returningVoter = true;
        // We return true to allow the user to continue as normal, since they opted back in.
        return true;
      } else if (this.constituent.status == ConstituentStatus.ENTERING) {
        this.handleHelplineFromOptedOutConstituent();
      }
    } else if (constituentMessageIsOptOut) {
      logger.info(
        `ConstituentManagementService.handleOptOutLogic: Received STOP text from phone number: ${this.constituent.phoneNumber}.`
      );
      // Check is necessary in case a previously seen voter doesn't have a Slack thread
      // and their 2nd+ message is STOP, in which case there's nothing to collapse.
      if (this.constituent.info && 'activeChannelId' in this.constituent.info) {
        // This function also handles adding the phone number to blocklists.
        await SlackInteractionApiUtil.handleAutomatedCollapseOfVoterStatusPanel(
          {
            userInfo: this.constituent.info,
            redisClient,
            newVoterStatus: 'REFUSED',
            userPhoneNumber: this.constituent.phoneNumber,
            twilioPhoneNumber,
          }
        );
      }

      logger.info(
        `ConstituentManagementService.handleOptOutLogic: Received STOP text from phone number: ${this.constituent.phoneNumber}.`
      );
      // Block volunteers or automated system from sending messages to this number in the future,
      // even though there is no thread from which volunteers could do so.
      await RedisApiUtil.setHash(
        redisClient,
        'slackBlockedUserPhoneNumbers',
        {
          [this.constituent.phoneNumber]: '1',
        }
      );
      // If the voter's first messsage to us is STOP, ignore any and all subsequent messages.
      await RedisApiUtil.setHash(
        redisClient,
        'twilioBlockedUserPhoneNumbers',
        {
          [this.constituent.phoneNumber]: '1',
        }
      );

      if (this.constituent.info) {
        // Update thread needs attention status -> false
        await DbApiUtil.setThreadNeedsAttentionToDb(
          this.constituent.info[this.constituent.info.activeChannelId],
          this.constituent.info.activeChannelId,
          false
        );
      }
    }

    DbApiUtil.updateDbMessageEntryWithUserInfo(
      this.constituent.info!,
      inboundDbMessageEntry
    );

    if (this.constituent.info && 'activeChannelId' in this.constituent.info) {
      // This includes a DB write of the message.
      await SlackApiUtil.sendMessage(
        this.constituent.message,
        {
          parentMessageTs: this.constituent.info[this.constituent.info.activeChannelId],
          channel: this.constituent.info.activeChannelId,
          isVoterMessage: true,
        },
        inboundDbMessageEntry,
        this.constituent.info
      );
    } else {
      // The message isn't being relayed, so don't fill this field in Postgres.
      inboundDbMessageEntry.successfullySent = null;
      try {
        await DbApiUtil.logMessageToDb(inboundDbMessageEntry);
      } catch (error) {
        logger.info(
          `ConstituentManagementService.handleOptOutLogic: failed to log incoming voter message to DB`
        );
        Sentry.captureException(error);
      }
    }

    return false;
  }

  // Previous logic.
  public async handleKnownVoterBlockLogic(
    userInfo: UserInfo,
    userMessage: string,
    userPhoneNumber: string,
    twilioPhoneNumber: string,
    inboundDbMessageEntry: DbApiUtil.DatabaseMessageEntry
  ): Promise<boolean> {
    logger.debug('ENTERING ConstituentManagementService.handleKnownVoterBlockLogic');
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
        `ConstituentManagementService.handleKnownVoterBlockLogic: Received STOP text from phone number: ${userPhoneNumber}.`
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
            `ConstituentManagementService.handleKnownVoterBlockLogic: failed to log incoming voter message to DB`
          );
          Sentry.captureException(error);
        }
      }
    }
    return outboundTextsBlocked;
  }
}
