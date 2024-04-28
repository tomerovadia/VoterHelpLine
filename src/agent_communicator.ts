import * as DbApiUtil from './db_api_util';
import { UserInfo } from './types';
import { SlackSendMessageOptions, SlackSendMessageResponse } from './slack_api_util';
import * as SlackApiUtil from './slack_api_util';

export default class ConstituentCommunicator {
    // private twilioPhoneNumber: string;
    // private constituentPhoneNumber: string;
    // private twilioCallbackUrl: string;

    public async sendMessage(
        message: string,
        options: SlackSendMessageOptions
    ): Promise<null | SlackSendMessageResponse>;
    public async sendMessage(
        message: string,
        options: SlackSendMessageOptions,
        databaseMessageEntry: DbApiUtil.DatabaseMessageEntry,
        userInfo: UserInfo
    ): Promise<null | SlackSendMessageResponse>;
    public async sendMessage(
        message: string,
        options: SlackSendMessageOptions,
        databaseMessageEntry: DbApiUtil.DatabaseMessageEntry | null = null,
        userInfo: UserInfo | null = null
    ): Promise<null | SlackSendMessageResponse> {
        if (!userInfo || !databaseMessageEntry) {
            return SlackApiUtil.sendMessage(message, options);
        } else {
            return SlackApiUtil.sendMessage(message, options, databaseMessageEntry, userInfo);
        }
    }
}