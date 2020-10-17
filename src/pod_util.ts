import { memoize, sortBy, times } from 'lodash';
import { PromisifiedRedisClient } from './redis_client';
import logger from './logger';
import * as RedisApiUtil from './redis_api_util';
import * as SlackApiUtil from './slack_api_util';
import { OPEN_CLOSE_CHANNELS_BLOCK_ID_PREFIX } from './slack_interaction_ids';
import { getStateConstants } from './state_constants';
import { regionsList } from './state_region_config';
import { ChannelType, EntryPoint } from './types';

export interface PodFilters {
  /** Selected state or region name. Must be full name like "North Carolina" */
  stateOrRegionName: string;
  /** Selected filter type, if any */
  channelType: ChannelType;
}

export type ChannelInfo = {
  // Slack channel ID -- e.g. G12345678, may not exist if mismatch between Redis and Slack
  id?: string;
  // Channel Name, e.g. north-carolina
  channelName: string;
  // What kind of entrypoint is this?
  entrypoint: EntryPoint;
  // Relative weight in round-robin ranking. 0 is off.
  weight: number;
};

export const listStateAndRegions = memoize(() =>
  Object.values(getStateConstants()).concat(regionsList).sort()
);

const getValidStateAndRegionsSet = memoize(
  () => new Set(listStateAndRegions())
);

const isValidStateOrRegionName = (stateOrRegionName: string) =>
  getValidStateAndRegionsSet().has(stateOrRegionName);

export const getEntrypointTypes = (): EntryPoint[] => {
  if (process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA') {
    return ['PULL'];
  }
  return ['PULL', 'PUSH'];
};

function getRedisKeyWithStateOrRegionName(
  stateOrRegionName: string,
  channelType: ChannelType,
  entryPointType: EntryPoint
) {
  const nameNoSpaces = stateOrRegionName.replace(/\s+/g, '');
  const entrypointString = entryPointType === 'PULL' ? 'Pull' : 'Push';
  switch (channelType) {
    case 'NORMAL':
      return `openPods${entrypointString}${nameNoSpaces}`;
    case 'DEMO':
      return `openPods${entrypointString}Demo${nameNoSpaces}`;
  }
  throw new Error(`Unexpected channelType: ${channelType}`);
}

export function getChannelNamePrefixForStateOrRegionName(
  stateOrRegionName: string,
  channelType: ChannelType
): string {
  const nameWithHyphens = stateOrRegionName.toLowerCase().replace(/\s+/g, '-');
  switch (channelType) {
    case 'NORMAL':
      return `${nameWithHyphens}-`;
    case 'DEMO':
      return `demo-${nameWithHyphens}-`;
  }
  throw new Error(`Unexpected channelType: ${channelType}`);
}

async function getPodChannelStateForEntrypoint(
  redisClient: PromisifiedRedisClient,
  channelNamesAndIds: Record<string, string>,
  filters: PodFilters,
  entrypoint: EntryPoint
) {
  if (!getEntrypointTypes().includes(entrypoint)) return [];

  // Map from channel names to a state
  const ret: Record<string, ChannelInfo> = {};

  const openChannels = await redisClient.lrangeAsync(
    getRedisKeyWithStateOrRegionName(
      filters.stateOrRegionName,
      filters.channelType,
      entrypoint
    ),
    0,
    -1
  );

  // Helper to make default channel info object
  const makeChannelInfo = (channelName: string) => ({
    id: channelNamesAndIds[channelName],
    channelName,
    entrypoint,
    weight: 0,
  });

  // Count all the open channels
  openChannels.forEach((channelName) => {
    ret[channelName] = ret[channelName] || makeChannelInfo(channelName);
    ret[channelName].weight += 1;
  });

  // Assign weight 0 to any remaining channels.
  Object.keys(channelNamesAndIds).forEach((channelName: string) => {
    if (
      channelName.startsWith(
        getChannelNamePrefixForStateOrRegionName(
          filters.stateOrRegionName,
          filters.channelType
        )
      )
    )
      ret[channelName] = ret[channelName] || makeChannelInfo(channelName);
  });

  return sortBy(ret, 'channelName');
}

export async function getPodChannelState(
  redisClient: PromisifiedRedisClient,
  filters: PodFilters
): Promise<{ pull: ChannelInfo[]; push: ChannelInfo[] }> {
  // Get all channels from Redis cache or Slack API
  const channelNamesAndIds =
    (await SlackApiUtil.getSlackChannelNamesAndIds(redisClient)) || {};

  const [pullChannelInfo, pushChannelInfo] = await Promise.all([
    getPodChannelStateForEntrypoint(
      redisClient,
      channelNamesAndIds,
      filters,
      'PULL'
    ),
    getPodChannelStateForEntrypoint(
      redisClient,
      channelNamesAndIds,
      filters,
      'PUSH'
    ),
  ]);

  return {
    pull: pullChannelInfo,
    push: pushChannelInfo,
  };
}

export async function setChannelWeights(
  redisClient: PromisifiedRedisClient,
  filters: PodFilters,
  channelInfo: ChannelInfo[]
): Promise<void> {
  logger.info(
    `PodUtil.setChannelState called: ${JSON.stringify({
      filters,
      channelInfo,
    })}`
  );

  if (!isValidStateOrRegionName(filters.stateOrRegionName)) {
    throw new Error(
      `Unrecognized state or region ${filters.stateOrRegionName}`
    );
  }

  const pullList: string[] = [];
  const pushList: string[] = [];
  channelInfo.forEach(({ channelName, entrypoint, weight }) => {
    if (entrypoint === 'PULL') {
      times(weight, () => pullList.push(channelName));
      return;
    }
    if (entrypoint === 'PUSH') {
      times(weight, () => pushList.push(channelName));
      return;
    }
    logger.error(`Unexpected entrypoint type: ${entrypoint}`);
  });

  const pullKey = getRedisKeyWithStateOrRegionName(
    filters.stateOrRegionName,
    filters.channelType,
    'PULL'
  );
  const pushKey = getRedisKeyWithStateOrRegionName(
    filters.stateOrRegionName,
    filters.channelType,
    'PUSH'
  );

  // Update keys in a transaction to temporarily avoid leaving list in an empty state
  await RedisApiUtil.transactAsync(redisClient, (multi) => {
    let m = multi;
    m = m.del(pullKey, pushKey);
    if (pullList.length) m = m.rpush(pullKey, pullList);
    if (pushList.length) m = m.rpush(pushKey, pushList);
    return m;
  });
}

// We use block ID to identify which channel + entrypoint combo this is.
export function getBlockId({
  entrypoint,
  channelName,
}: {
  entrypoint: EntryPoint;
  channelName: string;
}): string {
  return `${OPEN_CLOSE_CHANNELS_BLOCK_ID_PREFIX}${entrypoint}:${channelName}`;
}

// Parse string generated by getBlockId
export function parseBlockId(
  value = ''
): {
  entrypoint: EntryPoint;
  channelName: string;
} {
  if (!value.startsWith(OPEN_CLOSE_CHANNELS_BLOCK_ID_PREFIX)) {
    throw new Error(`PodUtil.parseBlockId: Unexpected value ${value}`);
  }

  const [entrypoint, channelName] = value
    .slice(OPEN_CLOSE_CHANNELS_BLOCK_ID_PREFIX.length)
    .split(':');
  return {
    entrypoint: entrypoint as EntryPoint,
    channelName,
  };
}
