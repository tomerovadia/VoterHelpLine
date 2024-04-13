import ServiceCoordinator from './../../service_coordinator';
import DefaultConstituentManagementService from './default_constituent_management_service';
import DefaultAgentManagementService from './default_agent_management_service';
import DefaultDbService from './default_db_service';

export default class DefaultServiceCoordinator extends ServiceCoordinator {
    constructor(
        constituentManagementService: DefaultConstituentManagementService,
        agentManagementService: DefaultAgentManagementService,
        dbService: DefaultDbService,
    ) {
        super(constituentManagementService, agentManagementService, dbService);
    }
}