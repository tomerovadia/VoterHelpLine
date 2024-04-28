import logger from './logger';
import * as SlackApiUtil from './slack_api_util';
import redisClient from './redis_client';
import * as RedisApiUtil from './redis_api_util';
import { UserInfo } from './types';
import { SlackEventRequestBody } from './router';
// TODO: Remove dependency on Router.
import * as Router from './router';
import AgentCommunicator from './agent_communicator';

export default class AgentMessageHandler {
    private agentCommunicator: AgentCommunicator;

    constructor(agentCommunicator: AgentCommunicator) {
        this.agentCommunicator = agentCommunicator;
    }

    public async handleMessageEvent(
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
                await this.agentCommunicator.sendMessage(
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
}