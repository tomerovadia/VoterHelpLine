import logger from './logger';
import * as PodUtil from './pod_util';
import { SlackActionId } from './slack_interaction_ids';
import type { VoterStatus } from './types';
import { SlackCallbackId } from './slack_interaction_ids';
import { SlackModalPrivateMetadata } from './slack_interaction_handler';
import { getStateConstants } from './state_constants';

export type SlackBlock = {
  type: string;
  [key: string]: any;
};

export type SlackOption = {
  text: {
    type: 'plain_text' | 'mrkdwn';
    text: string;
    emoji?: boolean;
  };
  value: string;
};

export type SlackText = {
  type: 'plain_text' | 'mrkdwn';
  text: string;
  emoji?: boolean;
};

export type SlackElement = {
  type: string;
  action_id?: string;
  value?: string;
  initial_option?: SlackOption;
  initial_options?: SlackOption[];
  initial_user?: string;
  initial_users?: string[];
  placeholder?: SlackText;
  options?: SlackOption[];
};

export type SlackAction = SlackElement & {
  block_id: string;
  selected_option?: SlackOption;
  selected_options?: SlackOption[];
  selected_user?: string;
  selected_users?: string[];
  action_ts: string;
};

export type SlackView = {
  callback_id?: string;
  private_metadata?: string;
  title: SlackText;
  submit?: SlackText;
  blocks: {
    type: string;
    text?: SlackText;
    elements?: SlackElement[];
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

interface OpenCloseModalProps {
  /** Selected state code, if any e.g. FL, NC, OH */
  stateCode?: string;
  /** Selected filter type, if any */
  channelType?: PodUtil.CHANNEL_TYPE;
  /** Channels to display, if any */
  channelRows?: PodUtil.ChannelInfo[];
}

const getOptionForState = (stateCode: string): SlackOption => ({
  text: {
    type: 'plain_text',
    text: getStateConstants()[stateCode],
  },
  value: stateCode,
});

const getOptionForChannelType = (value: PodUtil.CHANNEL_TYPE): SlackOption => {
  const text = {
    [PodUtil.CHANNEL_TYPE.NORMAL]: 'Normal',
    [PodUtil.CHANNEL_TYPE.DEMO]: 'Demo',
  }[value];
  return {
    text: {
      type: 'plain_text',
      text,
    },
    value,
  };
};

const pullOption: SlackOption = {
  text: {
    type: 'plain_text',
    text: 'Pull',
  },
  value: PodUtil.ENTRYPOINT_TYPE.PULL,
};

const pushOption: SlackOption = {
  text: {
    type: 'plain_text',
    text: 'Push',
  },
  value: PodUtil.ENTRYPOINT_TYPE.PUSH,
};

export function getOpenCloseModal({
  stateCode,
  channelType,
  channelRows = [],
}: OpenCloseModalProps = {}): SlackView {
  logger.info('ENTERING SLACKBLOCKUTIL.getOpenCloseModal');

  // Create rows for each channel
  const rows = channelRows.map(
    ({ id, name, stateCode, entrypoints }): SlackBlock => {
      const blockId = PodUtil.getBlockId(stateCode, name);
      const text = id ? `*${name}*` : `*${name}* :warning: _channel not found_`;
      const options: SlackOption[] = [pullOption, pushOption];
      const initialOptions = entrypoints.map((type) => {
        switch (type) {
          case PodUtil.ENTRYPOINT_TYPE.PULL:
            return pullOption;
          case PodUtil.ENTRYPOINT_TYPE.PUSH:
            return pushOption;
        }
        logger.error(
          `SLACKBLOCKUTIL.getOpenCloseModal: Invalid entrypoint type for ${name}: ${type}`
        );
      });

      const accessory = {
        type: 'checkboxes',
        action_id: SlackActionId.OPEN_CLOSE_CHANNELS_CHANNEL_STATE_DROPDOWN,
        // Slack does not like an empty initial_options list
        initial_options: initialOptions.length ? initialOptions : undefined,
        options,
      };

      return {
        type: 'section',
        block_id: blockId,
        text: {
          type: 'mrkdwn',
          text,
        },
        accessory,
      };
    }
  );

  // Empty state
  if (!rows.length) {
    if (stateCode && channelType) {
      rows.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `No channels found. You may need to create some. Channels follow this format: \`${PodUtil.getChannelNamePrefixForState(
            stateCode,
            channelType
          )}0\``,
        },
      });
    } else {
      rows.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Please select a state and channel type.',
        },
      });
    }
  }

  return {
    type: 'modal',
    callback_id: SlackCallbackId.OPEN_CLOSE_CHANNELS_MODAL,
    title: {
      type: 'plain_text',
      text: 'Open / Close Channels',
    },
    blocks: [
      {
        type: 'actions',
        elements: [
          {
            type: 'static_select',
            action_id: SlackActionId.OPEN_CLOSE_CHANNELS_FILTER_STATE,
            placeholder: {
              type: 'plain_text',
              text: 'Select State',
            },
            initial_option: stateCode
              ? getOptionForState(stateCode)
              : undefined,
            options: Object.keys(getStateConstants()).map((key) =>
              getOptionForState(key)
            ),
          },
          {
            type: 'static_select',
            action_id: SlackActionId.OPEN_CLOSE_CHANNELS_FILTER_TYPE,
            placeholder: {
              type: 'plain_text',
              text: 'Select Type',
            },
            initial_option: channelType
              ? getOptionForChannelType(channelType)
              : undefined,
            options: Object.keys(PodUtil.CHANNEL_TYPE).map((channelType) =>
              getOptionForChannelType(channelType as PodUtil.CHANNEL_TYPE)
            ),
          },
        ],
      },
      ...rows,
    ],
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

// This function finds the element for a given action ID in a set of blocks
export function findElementWithActionId(
  blocks: SlackBlock[],
  actionId: string
): SlackElement | null {
  for (const i in blocks) {
    const block = blocks[i];
    if (block.type === 'actions') {
      const elements = block.elements;
      for (const j in elements) {
        const element = elements[j];
        if (element.action_id === actionId) {
          return element;
        }
      }
    }
  }

  // If we get here, we were unable to find the element with the specified action ID
  return null;
}

// This function mutates the blocks input.
export function populateDropdownNewInitialValue(
  blocks: SlackBlock[],
  actionId: string,
  newInitialValue?: string | null
): boolean {
  const element = findElementWithActionId(blocks, actionId);
  if (!element) return false;

  if (element.type === 'static_select') {
    // Assume new options is already in the list of old options

    element.initial_option =
      element.options &&
      element.options.find((o: SlackOption) => o.value === newInitialValue);
    if (newInitialValue && !element.initial_option) {
      logger.error(`Option with value ${newInitialValue} was not found`);
      return false;
    }

    // Javascript modifies the blocks by reference, return success
    return true;
  }

  if (element.type === 'users_select') {
    if (newInitialValue) {
      element.initial_user = newInitialValue;
    } else {
      delete element.initial_user;
    }

    // Javascript modifies the blocks by reference, return success
    return true;
  }

  // Unsupported element type, probably not what we'r looking for
  logger.warn(
    `Unexpected element type in populateDropdownNewInitialValue: ${element.type}`
  );
  return false;
}
