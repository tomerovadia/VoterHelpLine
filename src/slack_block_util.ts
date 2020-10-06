import logger from './logger';
import { SlackActionId } from './slack_interaction_ids';
import type { VoterStatus } from './types';
import { SlackModalPrivateMetadata } from './slack_interaction_handler';

export type SlackBlock = {
  type: string;
  [key: string]: any;
};

export type SlackOption = {
  text: {
    type: 'plain_text' | 'mrkdwn';
    text: string;
    emoji: boolean;
  };
  value: string;
};

export type SlackView = {
  callback_id?: string;
  private_metadata?: string;
  title: {
    type: string;
    text: string;
  };
  submit?: {
    type: string;
    text: string;
  };
  blocks: {
    type: string;
    text: {
      type: string;
      text: string;
    };
  }[];
  type: 'modal';
};

export function getVoterStatusOptions(): { [key in VoterStatus]: string } {
  switch (process.env.CLIENT_ORGANIZATION) {
    case 'VOTER_HELP_LINE':
      return {
        UNKNOWN: 'Unknown',
        UNREGISTERED: 'Unregistered',
        REGISTERED: 'Registered',
        REQUESTED_BALLOT: 'Requested ballot',
        RECEIVED_BALLOT: 'Received ballot',
        IN_PERSON: 'Will vote in-person',
        VOTED: 'Voted',
        SPAM: 'Spam',
        REFUSED: 'Refused',
      };
    case 'VOTE_FROM_HOME_2020':
      return {
        UNKNOWN: 'Unknown',
        UNREGISTERED: 'Unregistered',
        REGISTERED: 'Registered',
        REQUESTED_BALLOT: 'Requested ballot',
        RECEIVED_BALLOT: 'Received ballot',
        IN_PERSON: 'Will vote in-person',
        VOTED: 'Voted',
        SPAM: 'Spam',
        REFUSED: 'Refused',
      };
    default:
      return {
        UNKNOWN: 'Unknown',
        UNREGISTERED: 'Unregistered',
        REGISTERED: 'Registered',
        REQUESTED_BALLOT: 'Requested ballot',
        RECEIVED_BALLOT: 'Received ballot',
        IN_PERSON: 'Will vote in-person',
        VOTED: 'Voted',
        SPAM: 'Spam',
        REFUSED: 'Refused',
      };
  }
}

export function voterInfoSection(messageText: string): SlackBlock {
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: messageText,
    },
  };
}

const volunteerSelectionPanel: SlackBlock = {
  type: 'actions',
  elements: [
    {
      type: 'users_select',
      action_id: SlackActionId.VOLUNTEER_DROPDOWN,
      placeholder: {
        type: 'plain_text',
        text: 'Claim this voter',
        emoji: true,
      },
    },
  ],
};

export const voterStatusPanel: SlackBlock = {
  type: 'actions',
  elements: [
    {
      type: 'static_select',
      action_id: SlackActionId.VOTER_STATUS_DROPDOWN,
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
      style: 'primary',
      text: {
        type: 'plain_text',
        text: 'Voted',
        emoji: true,
      },
      action_id: SlackActionId.VOTER_STATUS_VOTED_BUTTON,
      value: 'VOTED',
      confirm: {
        title: {
          type: 'plain_text',
          text: 'Are you sure?',
        },
        text: {
          type: 'mrkdwn',
          text:
            "Please confirm that you'd like to update this voter's status to VOTED.",
        },
        confirm: {
          type: 'plain_text',
          text: 'Confirm',
        },
        deny: {
          type: 'plain_text',
          text: 'Cancel',
        },
      },
    },
    {
      type: 'button',
      style: 'danger',
      text: {
        type: 'plain_text',
        text: 'Refused',
        emoji: true,
      },
      action_id: SlackActionId.VOTER_STATUS_REFUSED_BUTTON,
      value: 'REFUSED',
      confirm: {
        title: {
          type: 'plain_text',
          text: 'Are you sure?',
        },
        text: {
          type: 'mrkdwn',
          text:
            "Please confirm that you'd like to update this voter's status to REFUSED. This will block volunteers and our other platforms from messaging the voter.",
        },
        confirm: {
          type: 'plain_text',
          text: 'Confirm',
        },
        deny: {
          type: 'plain_text',
          text: 'Cancel',
        },
      },
    },
    {
      type: 'button',
      style: 'danger',
      text: {
        type: 'plain_text',
        text: 'Spam',
        emoji: true,
      },
      action_id: SlackActionId.VOTER_STATUS_SPAM_BUTTON,
      value: 'SPAM',
      confirm: {
        title: {
          type: 'plain_text',
          text: 'Are you sure?',
        },
        text: {
          type: 'mrkdwn',
          text:
            "Please confirm that you'd like to mark this phone number as SPAM. This will block their phone number from messaging us and all volunteers and our other platforms from messaging them.",
        },
        confirm: {
          type: 'plain_text',
          text: 'Confirm',
        },
        deny: {
          type: 'plain_text',
          text: 'Cancel',
        },
      },
    },
  ],
};

export function loadingSlackView(): SlackView {
  return {
    title: {
      type: 'plain_text',
      text: 'Loading...',
    },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Loading...',
        },
      },
    ],
    type: 'modal',
  };
}

export function resetConfirmationSlackView(
  callbackId: string,
  modalPrivateMetadata: SlackModalPrivateMetadata
): SlackView {
  return {
    callback_id: callbackId,
    private_metadata: JSON.stringify(modalPrivateMetadata),
    title: {
      type: 'plain_text',
      text: 'Are you sure?',
    },
    submit: {
      type: 'plain_text',
      text: 'Confirm',
    },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text:
            'Are you sure you want to end your demo conversation with this volunteer?\n\nYou will no longer be able to send messages to or receive messages from them, and they will be treated as a new demo voter the next time they send a text to this phone number.',
        },
      },
    ],
    type: 'modal',
  };
}

export function getErrorSlackView(
  callbackId: string,
  errorText: string
): SlackView {
  return {
    callback_id: callbackId,
    title: {
      type: 'plain_text',
      text: 'Oops!',
    },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: errorText,
        },
      },
    ],
    type: 'modal',
  };
}

export function getVoterStatusBlocks(messageText: string): SlackBlock[] {
  return [
    voterInfoSection(messageText),
    volunteerSelectionPanel,
    voterStatusPanel,
  ];
}

export function makeClosedVoterPanelBlocks(
  messageText: string,
  includeUndoButton: boolean
): SlackBlock[] {
  logger.info('ENTERING SLACKINTERACTIONAPIUTIL.getClosedVoterStatusPanel');

  const blocks = [];

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: messageText,
    },
  });

  if (includeUndoButton) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          action_id: SlackActionId.CLOSED_VOTER_PANEL_UNDO_BUTTON,
          style: 'danger',
          text: {
            type: 'plain_text',
            text: 'Undo',
            emoji: true,
          },
          value: 'UNDO',
          confirm: {
            title: {
              type: 'plain_text',
              text: 'Are you sure?',
            },
            text: {
              type: 'mrkdwn',
              text: "Please confirm you'd like to reset the voter's status.",
            },
            confirm: {
              type: 'plain_text',
              text: 'Confirm',
            },
            deny: {
              type: 'plain_text',
              text: 'Cancel',
            },
          },
        },
      ],
    });
  }
  return blocks;
}

export function replaceVoterPanelBlocks(
  oldBlocks: SlackBlock[],
  replacementBlocks: SlackBlock[]
): SlackBlock[] {
  const newBlocks = [];
  // The first block is the user info.
  newBlocks.push(oldBlocks[0]);
  // The second block is the volunteer dropdown.
  newBlocks.push(oldBlocks[1]);
  // The remaining blocks are the panel.
  for (const idx in replacementBlocks) {
    newBlocks.push(replacementBlocks[idx]);
  }
  return newBlocks;
}

// This function mutates the blocks input.
export function populateDropdownNewInitialValue(
  blocks: SlackBlock[],
  actionId: SlackActionId,
  newInitialValue: VoterStatus
): boolean {
  for (const i in blocks) {
    const block = blocks[i];
    if (block.type === 'actions') {
      const elements = block.elements;
      for (const j in elements) {
        const element = elements[j];
        if (element.action_id === actionId) {
          if (element.type === 'static_select') {
            // Assume new options is already in the list of old options
            element.initial_option = element.options.find(
              (o: SlackOption) => o.value === newInitialValue
            );
            // Javascript modifies the blocks by reference, return success
            return true;
          }
          if (element.type === 'users_select') {
            element.initial_user = newInitialValue;
            // Javascript modifies the blocks by reference, return success
            return true;
          }
        }
      }
    }
  }

  // If we get here, we were unable to find the element with the specified action ID
  return false;
}
