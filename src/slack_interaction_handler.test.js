import { makeSlackMessageBlockActionPayload } from './fixtures/slack_action_payload';
import {
  makeVoterStatusMessageWithoutActionIds,
  makeVoterStatusMessageWithActionIds,
} from './fixtures/slack_voter_status_message';
import * as DbApiUtil from './db_api_util';
import * as SlackApiUtil from './slack_api_util';
import * as SlackInteractionApiUtil from './slack_interaction_api_util';
import * as SlackInteractionHandler from './slack_interaction_handler';
import logger from './logger';

describe('SlackInteractionHandler', () => {
  describe('handleVoterStatusUpdate', () => {
    let error, updateVoterStatusBlocks, sendMessage, logVoterStatusToDb;
    beforeEach(() => {
      error = jest.spyOn(logger, 'error');
      updateVoterStatusBlocks = jest
        .spyOn(SlackInteractionApiUtil, 'updateVoterStatusBlocks')
        .mockImplementation(() => {});
      sendMessage = jest
        .spyOn(SlackApiUtil, 'sendMessage')
        .mockImplementation(() => {});
      logVoterStatusToDb = jest
        .spyOn(DbApiUtil, 'logVoterStatusToDb')
        .mockImplementation(() => {});
    });

    it.each([
      [
        'without specified action IDs',
        makeVoterStatusMessageWithoutActionIds(),
      ],
      ['with specified action IDs', makeVoterStatusMessageWithActionIds()],
    ])(
      'updates legacy voter status update blocks %s',
      async (_desc, message) => {
        await SlackInteractionHandler.handleVoterStatusUpdate({
          payload: makeSlackMessageBlockActionPayload({
            message,
            actions: [
              {
                ...message.blocks[2].elements[0],
                selected_option: {
                  text: { type: 'plain_text', text: 'Registered', emoji: true },
                  value: 'REGISTERED',
                },
                action_ts: '1601874231.783865',
              },
            ],
          }),
          selectedVoterStatus: 'REGISTERED',
          originatingSlackUserName: 'afong',
          slackChannelName: 'ohio-0',
          userPhoneNumber: '+15109362798',
          twilioPhoneNumber: '+18559032361',
          redisClient: {},
        });

        expect(error).not.toHaveBeenCalled();
        expect(sendMessage).toHaveBeenCalledWith(
          expect.stringMatching(
            /Voter status changed to \*REGISTERED\* by \*afong\*/
          ),
          {
            parentMessageTs: expect.any(String),
            channel: expect.any(String),
          }
        );
        expect(logVoterStatusToDb).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: expect.any(String),
            userPhoneNumber: '+15109362798',
            twilioPhoneNumber: '+18559032361',
            voterStatus: 'REGISTERED',
            originatingSlackUserName: 'afong',
            originatingSlackUserId: expect.any(String),
            slackChannelName: 'ohio-0',
            slackChannelId: expect.any(String),
            slackParentMessageTs: expect.any(String),
          })
        );
        expect(updateVoterStatusBlocks).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          expect.arrayContaining([
            expect.objectContaining({
              type: 'actions',
              elements: expect.arrayContaining([
                expect.objectContaining({
                  type: 'static_select',
                  initial_option: {
                    text: expect.objectContaining({
                      text: 'Registered',
                    }),
                    value: 'REGISTERED',
                  },
                }),
              ]),
            }),
          ])
        );
      }
    );
  });

  describe('handleVolunteerUpdate', () => {
    let error,
      fetchSlackUserName,
      replaceSlackMessageBlocks,
      sendMessage,
      logVolunteerVoterClaimToDb;
    beforeEach(() => {
      error = jest.spyOn(logger, 'error');
      fetchSlackUserName = jest
        .spyOn(SlackApiUtil, 'fetchSlackUserName')
        .mockImplementation(() => {});
      replaceSlackMessageBlocks = jest
        .spyOn(SlackInteractionApiUtil, 'replaceSlackMessageBlocks')
        .mockImplementation(() => {});
      sendMessage = jest
        .spyOn(SlackApiUtil, 'sendMessage')
        .mockImplementation(() => {});
      logVolunteerVoterClaimToDb = jest
        .spyOn(DbApiUtil, 'logVolunteerVoterClaimToDb')
        .mockImplementation(() => {});
    });

    it.each([
      [
        'without specified action IDs',
        makeVoterStatusMessageWithoutActionIds(),
      ],
      ['with specified action IDs', makeVoterStatusMessageWithActionIds()],
    ])('updates legacy volunteer update blocks %s', async (_desc, message) => {
      fetchSlackUserName.mockImplementation(() => Promise.resolve('johndoe'));
      await SlackInteractionHandler.handleVolunteerUpdate({
        payload: makeSlackMessageBlockActionPayload({
          message,
          actions: [
            {
              ...message.blocks[1].elements[0],
              selected_user: 'U99998888',
              action_ts: '1601874231.783865',
            },
          ],
        }),
        originatingSlackUserName: 'afong',
        slackChannelName: 'ohio-0',
        userPhoneNumber: '+15109362798',
        twilioPhoneNumber: '+18559032361',
      });

      expect(error).not.toHaveBeenCalled();
      expect(sendMessage).toHaveBeenCalledWith(
        expect.stringMatching(/Volunteer changed to \*johndoe\* by \*afong\*/),
        {
          parentMessageTs: expect.any(String),
          channel: expect.any(String),
        }
      );
      expect(logVolunteerVoterClaimToDb).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: expect.any(String),
          userPhoneNumber: '+15109362798',
          twilioPhoneNumber: '+18559032361',
          volunteerSlackUserName: 'johndoe',
          volunteerSlackUserId: 'U99998888',
          originatingSlackUserName: 'afong',
          originatingSlackUserId: expect.any(String),
          slackChannelName: 'ohio-0',
          slackChannelId: expect.any(String),
          slackParentMessageTs: expect.any(String),
        })
      );
      expect(replaceSlackMessageBlocks).toHaveBeenCalledWith({
        slackChannelId: expect.any(String),
        slackParentMessageTs: expect.any(String),
        newBlocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'actions',
            elements: expect.arrayContaining([
              expect.objectContaining({
                type: 'users_select',
                initial_user: 'U99998888',
              }),
            ]),
          }),
        ]),
      });
    });
  });
});
