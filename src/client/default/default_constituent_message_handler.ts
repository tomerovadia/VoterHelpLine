import ConstituentMessageHandler from '../../constituent_message_handler';
import ConstituentCommunicator from '../../constituent_communicator';
import AgentCommunicator from '../../agent_communicator';

export default class DefaultConstituentMessageHandler extends ConstituentMessageHandler {
    constructor(constituentCommunicator: ConstituentCommunicator, agentCommunicator: AgentCommunicator) {
        super(constituentCommunicator, agentCommunicator);
    }
}