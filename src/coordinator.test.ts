import Hashes from 'jshashes';

const mockConstituentPhoneNumber = 'mockConstituentPhoneNumber';
const mockTwilioPhoneNumber = 'mockTwilioPhoneNumber';
const mockConstituentMessage = 'mockConstituentMessage';
const mockSmsMessageSid = 'mockSmsMessageSid';

jest.mock('./agent_message_handler', () => {
    return jest.fn().mockImplementation(() => ({
        handleMessageEvent: jest.fn(),
    }));
});

jest.mock('./constituent_message_handler', () => {
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
        sendMessageToConstituent: jest.fn(),
        isPhoneNumberBlocked: jest.fn().mockReturnValue(false),
    }));
});

jest.mock('./db_service', () => {
    return jest.fn().mockImplementation(() => ({
        populateInitialIncomingConstituentMessageDbEntry: jest.fn().mockReturnValue({
            message: "mockUserMessage",
            unprocessedMessage: null,
            direction: 'INBOUND',
            entryPoint: 'PULL',
            automated: null,
            successfullySent: false,
            fromPhoneNumber: mockConstituentPhoneNumber,
            toPhoneNumber: mockTwilioPhoneNumber,
            originatingSlackUserId: null,
            originatingSlackUserName: null,
            slackChannel: null,
            slackParentMessageTs: null,
            mockSmsMessageSid,
            slackMessageTs: null,
            slackError: null,
            twilioError: null,
            twilioAttachments: [],
            twilioSendTimestamp: null,
            twilioReceiveTimestamp: new Date(),
            slackSendTimestamp: null,
            slackReceiveTimestamp: null,
            slackRetryNum: null,
            slackRetryReason: null,
            userId: null,
            confirmedDisclaimer: null,
            isDemo: null,
            lastVoterMessageSecsFromEpoch: null,
            archived: false,
            stateName: null,
        }),
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

jest.mock('./slack_api_util', () => ({
    sendMessage: jest.fn(),
}));

jest.mock('./keyword_parser', () => ({
    isVotedKeyword: jest.fn().mockReturnValue(false),
}));

import Coordinator from './coordinator';
import AgentMessageHandler from './agent_message_handler';
import AgentFeatureHandler from './agent_feature_handler';
import ConstituentMessageHandler from './constituent_message_handler';
import DbService from './db_service';
import ConstituentCommunicator from './constituent_communicator';
import AgentCommunicator from './agent_communicator';
import { ConstituentStatus, Request } from './types';

describe('handleIncomingSmsMessage', () => {
    let coordinator: Coordinator;
    let mockConstituentMessageHandler: ConstituentMessageHandler;
    let mockConstituentCommunicator: ConstituentCommunicator;
    let mockAgentCommunicator: AgentCommunicator;

    const mockReq = {
        body: {
            From: mockConstituentPhoneNumber,
            To: mockTwilioPhoneNumber,
            Body: mockConstituentMessage,
            SmsMessageSid: mockSmsMessageSid
        },
        headers:
        {
            host: 'localhost'
        }
    } as Request;

    const MD5 = new Hashes.MD5();

    beforeEach(() => {
        const mockAgentMessageHander = new AgentMessageHandler();
        const mockAgentFeatureHandler = new AgentFeatureHandler();
        mockConstituentMessageHandler = new ConstituentMessageHandler(mockConstituentCommunicator, mockAgentCommunicator);
        const mockDbService = new DbService();
        mockConstituentCommunicator = new ConstituentCommunicator();
        mockAgentCommunicator = new AgentCommunicator();

        coordinator = new Coordinator(mockConstituentMessageHandler, mockAgentMessageHander, mockAgentFeatureHandler, mockDbService, mockConstituentCommunicator, mockAgentCommunicator);

        // Reset mocks
        // TODO: Revisit whether this is necessary.
        jest.clearAllMocks();
    });

    describe("When the status is NEW", () => {
        beforeEach(() => {
            mockConstituentMessageHandler.getConstituentStatus = jest.fn().mockReturnValue(ConstituentStatus.NEW);
            mockConstituentCommunicator.sendMessage = jest.fn();
            mockAgentCommunicator.sendMessage = jest.fn();
        });

        it('Should call constituentCommunicator.sendMessage with welcome', async () => {
            await coordinator.handleIncomingSmsMessage(mockReq, 'PULL');

            expect(mockConstituentCommunicator.sendMessage).toHaveBeenCalledTimes(1);
            expect(mockConstituentCommunicator.sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringMatching(/welcome/i),
                    automated: true
                }),
            );
        });

        // it('Should call Router.prepareUserInfoForNewVoter and Router.welcomePotentialVoter', async () => {
        //     await coordinator.handleIncomingSmsMessage(mockReq, 'PULL');

        //     expect(Router.prepareUserInfoForNewVoter).toHaveBeenCalledTimes(1);
        //     expect(Router.welcomePotentialVoter).toHaveBeenCalledTimes(1);
        // });

        // it('Should correctly pass constituent info to Router.prepareUserInfoForNewVoter', async () => {    
        //     await coordinator.handleIncomingSmsMessage(mockReq, 'PULL');

        //     expect(Router.prepareUserInfoForNewVoter).toHaveBeenCalledWith(expect.objectContaining({
        //         userOptions: expect.objectContaining({
        //             userPhoneNumber: mockConstituentPhoneNumber,
        //             userMessage: mockConstituentMessage,
        //             userAttachments: [],
        //             userId: MD5.hex(mockConstituentPhoneNumber),
        //         }),
        //         twilioPhoneNumber: mockTwilioPhoneNumber,
        //         entryPoint: 'PULL',
        //         returningVoter: false,
        //       }));
        // });
    });

    // describe("When the status is PRE_ENTERING_AUTOMATED", () => {
    //     beforeEach(() => {
    //         mockConstituentManagementService.getConstituentStatus = jest.fn().mockReturnValue(ConstituentStatus.PRE_ENTERING_AUTOMATED);
    //     });
    //     it('Should call Router.clarifyHelplineRequest', async () => {
    //         await coordinator.handleIncomingSmsMessage(mockReq, 'PULL');
    //         expect(Router.clarifyHelplineRequest).toHaveBeenCalledTimes(1);
    //     });
    // });

    // describe("When the status is HAS_ENTERED_AUTOMATED", () => {
    //     beforeEach(() => {
    //         mockConstituentManagementService.getConstituentStatus = jest.fn().mockReturnValue(ConstituentStatus.HAS_ENTERED_AUTOMATED);
    //     });

    //     it('Should call Router.prepareUserInfoForNewVoter', async () => {
    //         await coordinator.handleIncomingSmsMessage(mockReq, 'PULL');

    //         expect(Router.determineVoterState).toHaveBeenCalledTimes(1);
    //     });

    //     describe("When the voter message indicates they've voted", () => {
    //         beforeEach(() => {
    //             const { isVotedKeyword } = require('./keyword_parser');
    //             isVotedKeyword.mockReturnValue(true);
    //         });

    //         it('Should call Router.recordVotedStatus and Router.replyToVoted', async () => {
    //             await coordinator.handleIncomingSmsMessage(mockReq, 'PULL');

    //             expect(Router.recordVotedStatus).toHaveBeenCalledTimes(1);
    //             expect(Router.replyToVoted).toHaveBeenCalledTimes(1);
    //         });
    //     });
    // });

    // describe("When the status is HAS_ENTERED_CONVERSATION", () => {
    //     beforeEach(() => {
    //         mockConstituentManagementService.getConstituentStatus = jest.fn().mockReturnValue(ConstituentStatus.HAS_ENTERED_CONVERSATION);
    //     });

    //     it('Should call Router.handleClearedVoter', async () => {
    //         await coordinator.handleIncomingSmsMessage(mockReq, 'PULL');

    //         expect(Router.handleClearedVoter).toHaveBeenCalledTimes(1);
    //     });

    //     describe("When the voter message indicates they've voted", () => {
    //         beforeEach(() => {
    //             const { isVotedKeyword } = require('./keyword_parser');
    //             isVotedKeyword.mockReturnValue(true);
    //         });

    //         it('Should call Router.recordVotedStatus and Router.replyToVoted', async () => {
    //             await coordinator.handleIncomingSmsMessage(mockReq, 'PULL');

    //             expect(Router.recordVotedStatus).toHaveBeenCalledTimes(1);
    //             expect(Router.handleClearedVoter).toHaveBeenCalledTimes(1);
    //         });
    //     });
    // });

    // describe("When the status is RETURNING", () => {
    //     beforeEach(() => {
    //         mockConstituentManagementService.getConstituentStatus = jest.fn().mockReturnValue(ConstituentStatus.RETURNING);
    //     });

    //     it('Should call Router.prepareUserInfoForNewVoter and Router.handleNewVoter', async () => {
    //         await coordinator.handleIncomingSmsMessage(mockReq, 'PULL');

    //         expect(Router.endVoterSession).toHaveBeenCalledTimes(1);
    //         expect(Router.prepareUserInfoForNewVoter).toHaveBeenCalledTimes(1);
    //         expect(Router.handleNewVoter).toHaveBeenCalledTimes(1);
    //     });

    //     describe("When the voter message indicates they've voted", () => {
    //         beforeEach(() => {
    //             const { isVotedKeyword } = require('./keyword_parser');
    //             isVotedKeyword.mockReturnValue(true);
    //         });

    //         it('Should call Router.recordVotedStatus', async () => {
    //             await coordinator.handleIncomingSmsMessage(mockReq, 'PULL');

    //             expect(Router.recordVotedStatus).toHaveBeenCalledTimes(1);
    //             expect(Router.endVoterSession).toHaveBeenCalledTimes(1);
    //             expect(Router.prepareUserInfoForNewVoter).toHaveBeenCalledTimes(1);
    //             expect(Router.handleNewVoter).toHaveBeenCalledTimes(1);
    //         });
    //     });
    // });
});