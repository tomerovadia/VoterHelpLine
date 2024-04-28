import * as DbApiUtil from './db_api_util';
import { UserInfo } from './types';
import * as TwilioApiUtil2 from './twilio_api_util_refactored';
import * as Sentry from '@sentry/node';
import logger from './logger';

export default class ConstituentCommunicator {
    private twilioPhoneNumber: string;
    private constituentPhoneNumber: string;
    private twilioCallbackUrl: string;

    constructor(twilioPhoneNumber: string, constituentPhoneNumber: string, twilioCallbackUrl: string) {
        this.twilioPhoneNumber = twilioPhoneNumber;
        this.constituentPhoneNumber = constituentPhoneNumber;
        this.twilioCallbackUrl = twilioCallbackUrl;
    }

    public async sendMessage({
        message,
        media,
        deduplicationId,
        automated,
        userInfo,
    }: {
        message: string;
        media?: string[];
        deduplicationId?: string;
        automated: boolean;
        userInfo: UserInfo;
    }
    ): Promise<void> {
        logger.info(`ENTERING ConstituentCommunicator.sendMessageToConstituent`);
        // TODO: Might need to initialize an object here for starters.
        let databaseMessageEntry;
        if (automated) {
            databaseMessageEntry = DbApiUtil.populateAutomatedDbMessageEntry(userInfo!);
        } else {
            // TODO: Change this once I come upon the human message send path.
            databaseMessageEntry = DbApiUtil.populateAutomatedDbMessageEntry(userInfo!);
        }

        databaseMessageEntry.message = message;
        databaseMessageEntry.fromPhoneNumber = this.twilioPhoneNumber;
        databaseMessageEntry.toPhoneNumber = this.constituentPhoneNumber;
        databaseMessageEntry.twilioSendTimestamp = new Date();

        logger.info(
            `ConstituentCommunicator.sendMessage: Including attachments ${JSON.stringify(
                media
            )}`
        );
        const twilioSendMessageResponse = await TwilioApiUtil2.sendMessage(message, media, {
            deduplicationId,
            twilioPhoneNumber: this.twilioPhoneNumber,
            userPhoneNumber: this.constituentPhoneNumber,
            twilioCallbackURL: this.twilioCallbackUrl,
        });

        if (twilioSendMessageResponse && twilioSendMessageResponse.success) {
            databaseMessageEntry.successfullySent = true;
            databaseMessageEntry.twilioMessageSid = twilioSendMessageResponse.sid;
        } else {
            const twilioError = twilioSendMessageResponse.error;
            const twilioErrorMessage = !twilioError ? '' : `Status: ${'status' in twilioError ? twilioError.status : ''
                }, Message:${'message' in twilioError ? twilioError.message : ''}, Code: ${'code' in twilioError ? twilioError.code : ''
                }, More Info: ${'more_info' in twilioError ? twilioError.more_info : ''}`;
            logger.error(
                `TWILIOAPIUTIL.sendMessage: ERROR in sending Twilio message. Error data from Twilio: ${twilioErrorMessage}`
            );

            databaseMessageEntry.successfullySent = false;

            if (twilioSendMessageResponse.errorMessage == 'helpline_deduplication_filtered') {
                // TODO: Modify this to not use the db entry, which should only be for db purposes.
                logger.warn(
                    'ConstituentCommunicator.sendMessageToConstituent: Not sending duplicate Twilio message ' +
                    `triggered by Slack message ${databaseMessageEntry.slackMessageTs} in ` +
                    `channel ${databaseMessageEntry.slackChannel} to ${this.constituentPhoneNumber}: ${message}`
                );
            }
            databaseMessageEntry.twilioError = twilioErrorMessage ? twilioErrorMessage : twilioSendMessageResponse.errorMessage;
        }

        try {
            // TODO: Use dbService for this instead.
            await DbApiUtil.logMessageToDb(databaseMessageEntry);
        } catch (error) {
            logger.error(
                'ConstituentCommunicator.sendMessageToConstituent: failed to log message send to DB'
            );
            Sentry.captureException(error);
        }
    }
}