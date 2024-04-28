import AgentMessageHandler from './../../agent_message_handler';
import AgentCommunicator from './../../agent_communicator';

export default class DefaultAgentMessageHandler extends AgentMessageHandler {
    constructor(agentCommunicator: AgentCommunicator) {
        super(agentCommunicator);
    }
}