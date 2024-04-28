import ConstituentMessageHandler from '../../constituent_message_handler';
import ConstituentCommunicator from '../../constituent_communicator';
import AgentCommunicator from '../../agent_communicator';
import config from './../../config';
import { ConstituentStatus } from '../../types';
import * as KeywordParser from './../../keyword_parser';
import logger from './../../logger';

export default class DefaultConstituentMessageHandler extends ConstituentMessageHandler {
    constructor(constituentCommunicator: ConstituentCommunicator, agentCommunicator: AgentCommunicator) {
        super(constituentCommunicator, agentCommunicator);
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
              `ConstituentMessageHandler.determineConstituentStatus (${constituentId}): determined that voter is returning from a previous cycle, starting with fresh userInfo`
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
        `ConstituentMessageHandler.determineConstituentStatus (${constituentId}): No existing userInfo for user after Redis retrieval with redisHashKey ${`${constituentId}:${this.twilioPhoneNumber}`}`);
        if (this.constituent.message && KeywordParser.isHelplineKeyword(this.constituent.message)) {
          // TODO: We might need a special message for constituents who are messaging for the very first
          // time and their message is HELPLINE. Rather than "ok..." we should have a bit of a welcome.
          this.constituent.status = ConstituentStatus.ENTERING;
        } else {
          this.constituent.status = ConstituentStatus.NEW;
        }
    }
  }
}