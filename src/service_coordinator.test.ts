import Hashes from 'jshashes';

jest.mock('./agent_management_service', () => {
    return jest.fn().mockImplementation(() => ({
        isPhoneNumberBlocked: jest.fn().mockReturnValue(false),
    }));
});
  
jest.mock('./constituent_management_service', () => {
    return jest.fn().mockImplementation(() => ({
        getConstituentStatus: jest.fn(),
        setConstituentId: jest.fn(),
        setConstituentPhoneNumber: jest.fn(),
        setConstituentMessage: jest.fn(),
        setUserAttachments: jest.fn(),
        setTwilioPhoneNumber: jest.fn(),
        setEntryPoint: jest.fn(),
        setTwilioCallbackURL: jest.fn(),
        setInboundDbMessageEntry: jest.fn(),
        fetchAndLoadConstituentInfo: jest.fn().mockReturnValue({
            stateName: 'testStateName',
        }),
        fetchAndLoadOptOutStatus: jest.fn(),
        determineConstituentStatus: jest.fn(),
        handleOptOutLogic: jest.fn().mockReturnValue(true),
    }));
});
jest.mock('./db_service', () => {
    return jest.fn().mockImplementation(() => ({
        populateInitialIncomingConstituentMessageDbEntry: jest.fn(),
    }));
});

jest.mock('./twilio_util', () => ({
  twilioCallbackURL: jest.fn(),
  getAttachments: jest.fn().mockReturnValue([]),
}));
jest.mock('./router', () => ({
  prepareUserInfoForNewVoter: jest.fn(),
  welcomePotentialVoter: jest.fn(),
  clarifyHelplineRequest: jest.fn(),
  handleNewVoter: jest.fn(),
  endVoterSession: jest.fn(),
  determineVoterState: jest.fn(),
  recordVotedStatus: jest.fn(),
  replyToVoted: jest.fn(),
  handleClearedVoter: jest.fn(),
}));

jest.mock('./keyword_parser', () => ({
    isVotedKeyword: jest.fn().mockReturnValue(false),
}));

import ServiceCoordinator from './service_coordinator';
import AgentManagementService from './agent_management_service';
import ConstituentManagementService from './constituent_management_service';
import DbService from './db_service';
import * as Router from './router';
import * as KeywordParser from './keyword_parser';
import { ConstituentStatus, Request } from './types';

describe('handleIncomingSmsMessage', () => {
    let serviceCoordinator: ServiceCoordinator;
    let mockConstituentManagementService: ConstituentManagementService;

    const testConstituentPhoneNumber = 'testConstituentPhoneNumber';
    const testTwilioPhoneNumber = 'testTwilioPhoneNumber';
    const testConstituentMessage = 'testConstituentMessage';
    const testSmsMessageSid = 'testSmsMessageSid';

    const mockReq = { body: {
        From: testConstituentPhoneNumber,
        To: testTwilioPhoneNumber,
        Body: testConstituentMessage,
        SmsMessageSid: testSmsMessageSid }
    } as Request;

    const MD5 = new Hashes.MD5();

    beforeEach(() => {
        const mockAgentManagementService = new AgentManagementService();
        mockConstituentManagementService = new ConstituentManagementService();
        const mockDbService = new DbService();

        serviceCoordinator = new ServiceCoordinator(mockConstituentManagementService, mockAgentManagementService, mockDbService);

        // Reset mocks
        // TODO: Revisit whether this is necessary.
        jest.clearAllMocks();
    });

    describe("When the status is NEW", () => {
        beforeEach(() => {
            mockConstituentManagementService.getConstituentStatus = jest.fn().mockReturnValue(ConstituentStatus.NEW);
        });

        it('Should call Router.prepareUserInfoForNewVoter and Router.welcomePotentialVoter', async () => {
            await serviceCoordinator.handleIncomingSmsMessage(mockReq, 'PULL');

            expect(Router.prepareUserInfoForNewVoter).toHaveBeenCalledTimes(1);
            expect(Router.welcomePotentialVoter).toHaveBeenCalledTimes(1);
        });

        it('Should correctly pass constituent info to Router.prepareUserInfoForNewVoter', async () => {    
            await serviceCoordinator.handleIncomingSmsMessage(mockReq, 'PULL');

            expect(Router.prepareUserInfoForNewVoter).toHaveBeenCalledWith(expect.objectContaining({
                userOptions: expect.objectContaining({
                    userPhoneNumber: testConstituentPhoneNumber,
                    userMessage: testConstituentMessage,
                    userAttachments: [],
                    userId: MD5.hex(testConstituentPhoneNumber),
                }),
                twilioPhoneNumber: testTwilioPhoneNumber,
                entryPoint: 'PULL',
                returningVoter: false,
              }));
        });
    });

    describe("When the status is PRE_ENTERING_AUTOMATED", () => {
        beforeEach(() => {
            mockConstituentManagementService.getConstituentStatus = jest.fn().mockReturnValue(ConstituentStatus.PRE_ENTERING_AUTOMATED);
        });
        it('Should call Router.clarifyHelplineRequest', async () => {
            await serviceCoordinator.handleIncomingSmsMessage(mockReq, 'PULL');
            expect(Router.clarifyHelplineRequest).toHaveBeenCalledTimes(1);
        });
    });

    describe("When the status is HAS_ENTERED_AUTOMATED", () => {
        beforeEach(() => {
            mockConstituentManagementService.getConstituentStatus = jest.fn().mockReturnValue(ConstituentStatus.HAS_ENTERED_AUTOMATED);
        });

        it('Should call Router.prepareUserInfoForNewVoter', async () => {
            await serviceCoordinator.handleIncomingSmsMessage(mockReq, 'PULL');

            expect(Router.determineVoterState).toHaveBeenCalledTimes(1);
        });

        describe("When the voter message indicates they've voted", () => {
            beforeEach(() => {
                const { isVotedKeyword } = require('./keyword_parser');
                isVotedKeyword.mockReturnValue(true);
            });

            it('Should call Router.recordVotedStatus and Router.replyToVoted', async () => {
                await serviceCoordinator.handleIncomingSmsMessage(mockReq, 'PULL');
    
                expect(Router.recordVotedStatus).toHaveBeenCalledTimes(1);
                expect(Router.replyToVoted).toHaveBeenCalledTimes(1);
            });
        });
    });

    describe("When the status is HAS_ENTERED_CONVERSATION", () => {
        beforeEach(() => {
            mockConstituentManagementService.getConstituentStatus = jest.fn().mockReturnValue(ConstituentStatus.HAS_ENTERED_CONVERSATION);
        });

        it('Should call Router.handleClearedVoter', async () => {
            await serviceCoordinator.handleIncomingSmsMessage(mockReq, 'PULL');

            expect(Router.handleClearedVoter).toHaveBeenCalledTimes(1);
        });

        describe("When the voter message indicates they've voted", () => {
            beforeEach(() => {
                const { isVotedKeyword } = require('./keyword_parser');
                isVotedKeyword.mockReturnValue(true);
            });

            it('Should call Router.recordVotedStatus and Router.replyToVoted', async () => {
                await serviceCoordinator.handleIncomingSmsMessage(mockReq, 'PULL');
    
                expect(Router.recordVotedStatus).toHaveBeenCalledTimes(1);
                expect(Router.handleClearedVoter).toHaveBeenCalledTimes(1);
            });
        });
    });

    describe("When the status is RETURNING", () => {
        beforeEach(() => {
            mockConstituentManagementService.getConstituentStatus = jest.fn().mockReturnValue(ConstituentStatus.RETURNING);
        });

        it('Should call Router.prepareUserInfoForNewVoter and Router.handleNewVoter', async () => {
            await serviceCoordinator.handleIncomingSmsMessage(mockReq, 'PULL');

            expect(Router.endVoterSession).toHaveBeenCalledTimes(1);
            expect(Router.prepareUserInfoForNewVoter).toHaveBeenCalledTimes(1);
            expect(Router.handleNewVoter).toHaveBeenCalledTimes(1);
        });

        describe("When the voter message indicates they've voted", () => {
            beforeEach(() => {
                const { isVotedKeyword } = require('./keyword_parser');
                isVotedKeyword.mockReturnValue(true);
            });

            it('Should call Router.recordVotedStatus', async () => {
                await serviceCoordinator.handleIncomingSmsMessage(mockReq, 'PULL');
    
                expect(Router.recordVotedStatus).toHaveBeenCalledTimes(1);
                expect(Router.endVoterSession).toHaveBeenCalledTimes(1);
                expect(Router.prepareUserInfoForNewVoter).toHaveBeenCalledTimes(1);
                expect(Router.handleNewVoter).toHaveBeenCalledTimes(1);
            });
        });
    });
});
