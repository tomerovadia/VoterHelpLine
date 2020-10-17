import { times } from 'lodash';
import logger from './logger';
import * as PodUtil from './pod_util';
import { SlackActionId } from './slack_interaction_ids';
import { SlackCallbackId } from './slack_interaction_ids';
import { getStateConstants } from './state_constants';
import { regionsList } from './state_region_config';
import { SlackBlock, SlackOption, SlackView } from './slack_block_util';

interface OpenCloseModalProps {
  /** Selected state or region */
  stateOrRegionName?: string;
  /** Selected filter type, if any */
  channelType?: PodUtil.CHANNEL_TYPE;
  /** Pull channels to display, if any */
  pullRows?: PodUtil.ChannelInfo[];
  /** Push channels to display, if any */
  pushRows?: PodUtil.ChannelInfo[];
  /** Optional status message of some kind */
  flashMessage?: string;
}

const getOptionForStateOrRegion = (stateOrRegionName: string): SlackOption => ({
  text: {
    type: 'plain_text',
    text: stateOrRegionName,
  },
  value: stateOrRegionName,
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

// Weights for dropdown for each channel
const getOptionForWeight = (n: number): SlackOption => ({
  text: {
    type: 'plain_text',
    text: String(n),
  },
  value: String(n),
});

const weightOptions: SlackOption[] = times(10, getOptionForWeight);

const getBlocksForChannelInfo = (entrypoint: PodUtil.ENTRYPOINT_TYPE) => ({
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
  const pullBlocks = pullRows.map(
    getBlocksForChannelInfo(PodUtil.ENTRYPOINT_TYPE.PULL)
  );
  const pushBlocks = pushRows.map(
    getBlocksForChannelInfo(PodUtil.ENTRYPOINT_TYPE.PUSH)
  );

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
        option_groups: regionsList.length
          ? [
              {
                label: {
                  type: 'plain_text',
                  text: 'Regions',
                },
                options: regionsList.map(getOptionForStateOrRegion),
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
        options: regionsList.length
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
        options: Object.keys(PodUtil.CHANNEL_TYPE).map((channelType) =>
          getOptionForChannelType(channelType as PodUtil.CHANNEL_TYPE)
        ),
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
    callback_id: SlackCallbackId.OPEN_CLOSE_CHANNELS_MODAL,
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
  hasAtLeastOnePull: boolean;
  hasAtLeastOnePush: boolean;
  values: any;
}

export function openCloseConfirmationView({
  hasAtLeastOnePull,
  hasAtLeastOnePush,
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
  if (!hasAtLeastOnePull) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          ':warning: There are no *pull* entrypoints associated with this state or region.',
      },
    });
  }
  if (!hasAtLeastOnePush) {
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
    callback_id: SlackCallbackId.OPEN_CLOSE_CHANNELS_CONFIRM_MODAL,
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
