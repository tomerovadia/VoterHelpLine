import {
    EntryPoint,
  } from './types';
  import * as DbApiUtil from './db_api_util';

export default class DbService {

    // Populates immediately available info into the DB entry upon receiving a message from Twilio.
   public populateInitialIncomingConstituentMessageDbEntry({
        userMessage,
        userPhoneNumber,
        twilioPhoneNumber,
        twilioMessageSid,
        twilioAttachments,
        entryPoint,
    }: {
        userMessage: string;
        userPhoneNumber: string;
        twilioPhoneNumber: string;
        twilioMessageSid: string;
        twilioAttachments: string[];
        entryPoint: EntryPoint;
    }): DbApiUtil.DatabaseMessageEntry {
        return {
        message: userMessage,
        // Only for Slack incoming
        unprocessedMessage: null,
        direction: 'INBOUND',
        // To be filled later
        entryPoint,
        automated: null,
        // To be updated later
        successfullySent: false,
        fromPhoneNumber: userPhoneNumber,
        toPhoneNumber: twilioPhoneNumber,
        originatingSlackUserId: null,
        originatingSlackUserName: null,
    
        // To be filled later
        slackChannel: null,
        // To be filled later
        slackParentMessageTs: null,
    
        twilioMessageSid,
        // To be filled later
        slackMessageTs: null,
        // To be maybe filled later
        slackError: null,
        twilioError: null,
    
        // Array of attached media to MMS
        twilioAttachments,
    
        twilioSendTimestamp: null,
        twilioReceiveTimestamp: new Date(),
        // To be filled later
        slackSendTimestamp: null,
        slackReceiveTimestamp: null,
    
        // Only for Slack incoming
        slackRetryNum: null,
        // Only for Slack incoming
        slackRetryReason: null,
    
        // Note: These are userInfo fields. Keep these null so that their only set is right before sending, so that the actual values are ensured to be logged.
        // To be filled later
        userId: null,
        // To be filled later
        confirmedDisclaimer: null,
        // To be filled later
        isDemo: null,
        // To be filled later
        lastVoterMessageSecsFromEpoch: null,
    
        archived: false,
    
        // To be filled later
        stateName: null,
        };
    }
}