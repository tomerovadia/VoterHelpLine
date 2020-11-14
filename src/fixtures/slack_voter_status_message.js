import { SlackActionId } from '../slack_interaction_ids';

// Legacy, pre-action ID voter status message object
export const makeVoterStatusMessageWithoutActionIds = () => ({
  bot_id: 'B01BX6Q5LQ2',
  type: 'message',
  text: "This content can't be displayed.",
  user: 'U01BGEC9T7H',
  ts: '1601785422.000500',
  team: 'T01CM1QC54Y',
  edited: { user: 'B01BX6Q5LQ2', ts: '1601873060.000000' },
  blocks: [
    {
      type: 'section',
      block_id: 'NjLm',
      text: {
        type: 'mrkdwn',
        text:
          '<!channel> New *Ohio* voter\nf39f57796f6ca7eac2aac2fdd794375 via +18559032361',
        verbatim: false,
      },
    },
    {
      type: 'actions',
      block_id: '9dWv',
      elements: [
        {
          type: 'users_select',
          action_id: 'VOLUNTEER_DROPDOWN',
          initial_user: 'USLACKBOT',
          placeholder: {
            type: 'plain_text',
            text: 'Claim this voter',
            emoji: true,
          },
        },
      ],
    },
    {
      type: 'actions',
      block_id: '3=LF',
      elements: [
        {
          type: 'static_select',
          action_id: 'VOTER_STATUS_DROPDOWN',
          initial_option: {
            text: {
              type: 'plain_text',
              text: 'Unknown',
              emoji: true,
            },
            value: 'UNKNOWN',
          },
          options: [
            {
              text: {
                type: 'plain_text',
                text: 'Unknown',
                emoji: true,
              },
              value: 'UNKNOWN',
            },
            {
              text: {
                type: 'plain_text',
                text: 'Unregistered',
                emoji: true,
              },
              value: 'UNREGISTERED',
            },
            {
              text: {
                type: 'plain_text',
                text: 'Registered',
                emoji: true,
              },
              value: 'REGISTERED',
            },
            {
              text: {
                type: 'plain_text',
                text: 'Requested ballot',
                emoji: true,
              },
              value: 'REQUESTED_BALLOT',
            },
            {
              text: {
                type: 'plain_text',
                text: 'Received ballot',
                emoji: true,
              },
              value: 'RECEIVED_BALLOT',
            },
            {
              text: {
                type: 'plain_text',
                text: 'Will vote in-person',
                emoji: true,
              },
              value: 'IN_PERSON',
            },
          ],
        },
        {
          type: 'button',
          action_id: '0+H3',
          text: { type: 'plain_text', text: 'Voted', emoji: true },
          style: 'primary',
          value: 'VOTED',
          confirm: {
            title: {
              type: 'plain_text',
              text: 'Are you sure?',
              emoji: true,
            },
            text: {
              type: 'mrkdwn',
              text:
                "Please confirm that you'd like to update this voter's status to VOTED.",
              verbatim: false,
            },
            confirm: {
              type: 'plain_text',
              text: 'Confirm',
              emoji: true,
            },
            deny: {
              type: 'plain_text',
              text: 'Cancel',
              emoji: true,
            },
          },
        },
        {
          type: 'button',
          action_id: '0+H4',
          text: {
            type: 'plain_text',
            text: 'Refused',
            emoji: true,
          },
          style: 'danger',
          value: 'REFUSED',
          confirm: {
            title: {
              type: 'plain_text',
              text: 'Are you sure?',
              emoji: true,
            },
            text: {
              type: 'mrkdwn',
              text:
                "Please confirm that you'd like to update this voter's status to REFUSED. This will block volunteers and our other platforms from messaging the voter.",
              verbatim: false,
            },
            confirm: {
              type: 'plain_text',
              text: 'Confirm',
              emoji: true,
            },
            deny: {
              type: 'plain_text',
              text: 'Cancel',
              emoji: true,
            },
          },
        },
        {
          type: 'button',
          action_id: '0+H5',
          text: { type: 'plain_text', text: 'Spam', emoji: true },
          style: 'danger',
          value: 'SPAM',
          confirm: {
            title: {
              type: 'plain_text',
              text: 'Are you sure?',
              emoji: true,
            },
            text: {
              type: 'mrkdwn',
              text:
                "Please confirm that you'd like to mark this phone number as SPAM. This will block their phone number from messaging us and all volunteers and our other platforms from messaging them.",
              verbatim: false,
            },
            confirm: {
              type: 'plain_text',
              text: 'Confirm',
              emoji: true,
            },
            deny: {
              type: 'plain_text',
              text: 'Cancel',
              emoji: true,
            },
          },
        },
      ],
    },
  ],
  thread_ts: '1601785422.000500',
  reply_count: 21,
  reply_users_count: 2,
  latest_reply: '1601873059.004600',
  reply_users: ['U01BGEC9T7H', 'U01BGDZHPDM'],
  subscribed: true,
  last_read: '1601873059.004600',
});

// Voter status message object with action IDs
export const makeVoterStatusMessageWithActionIds = () => {
  const message = makeVoterStatusMessageWithoutActionIds();
  message.blocks[1].elements[0].action_id = SlackActionId.VOLUNTEER_DROPDOWN;
  message.blocks[2].elements[0].action_id = SlackActionId.VOTER_STATUS_DROPDOWN;
  message.blocks[2].elements[1].action_id =
    SlackActionId.VOTER_STATUS_REFUSED_BUTTON;
  message.blocks[2].elements[2].action_id =
    SlackActionId.VOTER_STATUS_SPAM_BUTTON;
  return message;
};
