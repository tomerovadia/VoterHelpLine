import Coordinator from '../../coordinator';
import DefaultConstituentMessageHandler from './default_constituent_message_handler';
import DefaultAgentMessageHandler from './default_agent_message_handler';
import DefaultAgentFeatureHandler from './default_agent_feature_handler';
import ConstituentCommunicator from '../../constituent_communicator';
import agentCommunicator from '../../agent_communicator';
import DefaultDbService from './default_db_service';

export default class DefaultCoordinator extends Coordinator {
    constructor(
        defaultConstituentManagementService: DefaultConstituentMessageHandler,
        agentMessageHandler: DefaultAgentMessageHandler,
        defaultAgentFeatureHandler: DefaultAgentFeatureHandler,
        defaultDbService: DefaultDbService,
        constituentCommunicator: ConstituentCommunicator,
        agentCommunicator: agentCommunicator
    ) {
        super(defaultConstituentManagementService, agentMessageHandler, defaultAgentFeatureHandler, defaultDbService, constituentCommunicator, agentCommunicator);
    }
}