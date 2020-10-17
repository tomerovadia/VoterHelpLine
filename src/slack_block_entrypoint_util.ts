import { times } from 'lodash';
import logger from './logger';
import * as PodUtil from './pod_util';
import { SlackActionId } from './slack_interaction_ids';
import { SlackCallbackId } from './slack_interaction_ids';
import { getStateConstants } from './state_constants';
import { regionsListMinusStates } from './state_region_config';
import { SlackBlock, SlackOption, SlackView } from './slack_block_util';
import { ChannelType, EntryPoint } from './types';

interface OpenCloseModalProps {
  /** Selected state or region */
  stateOrRegionName?: string;
  /** Selected filter type, if any */
  channelType?: ChannelType;
  /** Pull channels to display, if any */
  pullRows?: PodUtil.ChannelInfo[];
  /** Push channels to display, if any */
  pushRows?: PodUtil.ChannelInfo[];
  /** Optional status message of some kind */
  flashMessage?: string;
}

const CHANNEL_TYPES: ChannelType[] = ['NORMAL', 'DEMO'];

const getOptionForStateOrRegion = (stateOrRegionName: string): SlackOption => ({
  text: {
    type: 'plain_text',
    text: stateOrRegionName,
  },
  value: stateOrRegionName,
});

const getOptionForChannelType = (value: ChannelType): SlackOption => {
  const text = {
    NORMAL: 'Normal',
    DEMO: 'Demo',
  }[value];
  return {
    text: {
      type: 'plain_text',
      text,
    },
    value,
  };
};

// Weights for dropdown for each channel
const getOptionForWeight = (n: number): SlackOption => ({
  text: {
    type: 'plain_text',
    text: String(n),
  },
  value: String(n),
});

const weightOptions: SlackOption[] = times(10, getOptionForWeight);

const getBlocksForChannelInfo = (entrypoint: EntryPoint) => ({
  id,
  channelName,
  weight,
}: PodUtil.ChannelInfo): SlackBlock => {
  const blockId = PodUtil.getBlockId({
    channelName,
    entrypoint,
  });
  const text = id
    ? channelName
    : `${channelName} :warning: _channel not found_`;

  const accessory = {
    type: 'static_select',
    action_id: SlackActionId.OPEN_CLOSE_CHANNELS_CHANNEL_STATE_DROPDOWN,
    initial_option: getOptionForWeight(weight),
    options: weightOptions,
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
};

export function getOpenCloseModal({
  stateOrRegionName: selectedStateOrRegionName,
  channelType: selectedChannelType,
  pullRows = [],
  pushRows = [],
  flashMessage,
}: OpenCloseModalProps = {}): SlackView {
  logger.info('ENTERING SLACKBLOCKUTIL.getOpenCloseModal');

  // Create rows for each channel + entrypoint type
  const pullBlocks = pullRows.map(getBlocksForChannelInfo('PULL'));
  const pushBlocks = pushRows.map(getBlocksForChannelInfo('PUSH'));

  let rows: SlackBlock[] = [];
  if (flashMessage) {
    rows.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: flashMessage,
      },
    });

    rows.push({
      type: 'divider',
    });
  }

  // Selectors
  rows.push({
    type: 'actions',
    elements: [
      {
        type: 'static_select',
        action_id: SlackActionId.OPEN_CLOSE_CHANNELS_FILTER_STATE,
        placeholder: {
          type: 'plain_text',
          text: 'Select State',
        },
        initial_option: selectedStateOrRegionName
          ? getOptionForStateOrRegion(selectedStateOrRegionName)
          : undefined,
        option_groups: regionsListMinusStates.length
          ? [
              {
                label: {
                  type: 'plain_text',
                  text: 'Regions',
                },
                options: regionsListMinusStates.map(getOptionForStateOrRegion),
              },
              {
                label: {
                  type: 'plain_text',
                  text: 'States',
                },
                options: Object.values(getStateConstants()).map(
                  getOptionForStateOrRegion
                ),
              },
            ]
          : undefined,
        options: regionsListMinusStates.length
          ? undefined
          : Object.values(getStateConstants()).map(getOptionForStateOrRegion),
      },
      {
        type: 'static_select',
        action_id: SlackActionId.OPEN_CLOSE_CHANNELS_FILTER_TYPE,
        placeholder: {
          type: 'plain_text',
          text: 'Select Type',
        },
        initial_option: selectedChannelType
          ? getOptionForChannelType(selectedChannelType)
          : undefined,
        options: CHANNEL_TYPES.map(getOptionForChannelType),
      },
    ],
  });

  // Empty state
  if (!pullBlocks.length && !pushBlocks.length) {
    if (selectedStateOrRegionName && selectedChannelType) {
      rows.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `No channels found. You may need to create some. Channels follow this format: \`${PodUtil.getChannelNamePrefixForStateOrRegionName(
            selectedStateOrRegionName,
            selectedChannelType
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
  } else {
    if (pullBlocks.length) {
      rows.push({
        type: 'header',
        text: {
          type: 'plain_text',
          text: 'Pull',
        },
      });
      rows = rows.concat(pullBlocks);
    }
    if (pushBlocks.length) {
      rows.push({
        type: 'header',
        text: {
          type: 'plain_text',
          text: 'Push',
        },
      });
      rows = rows.concat(pushBlocks);
    }
  }

  return {
    type: 'modal',
    callback_id: SlackCallbackId.OPEN_CLOSE_CHANNELS,
    title: {
      type: 'plain_text',
      text: 'Open / Close Channels',
    },
    submit:
      pullBlocks.length || pushBlocks.length
        ? {
            type: 'plain_text',
            text: 'Save',
          }
        : undefined,
    blocks: rows,
  };
}

interface OpenCloseConfirmationProps {
  warnOnPull: boolean;
  warnOnPush: boolean;
  values: any;
}

export function openCloseConfirmationView({
  warnOnPull,
  warnOnPush,
  values,
}: OpenCloseConfirmationProps): SlackView {
  const blocks: SlackBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Are you sure you want to continue?',
      },
    },
  ];
  if (warnOnPull) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          ':warning: There are no *pull* entrypoints associated with this state or region.',
      },
    });
  }
  if (warnOnPush) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          ':warning: There are no *push* entrypoints associated with this state or region.',
      },
    });
  }

  return {
    type: 'modal',
    callback_id: SlackCallbackId.OPEN_CLOSE_CHANNELS_CONFIRM,
    title: {
      type: 'plain_text',
      text: 'Please confirm',
    },
    blocks,
    private_metadata: JSON.stringify(values),
    submit: {
      type: 'plain_text',
      text: 'Continue',
    },
    close: {
      type: 'plain_text',
      text: 'Back',
    },
  };
}
