import { sortBy } from 'lodash';
import { PromisifiedRedisClient } from './redis_client';
import logger from './logger';
import * as SlackApiUtil from './slack_api_util';
import { OPEN_CLOSE_CHANNELS_BLOCK_ID_PREFIX } from './slack_interaction_ids';
import { getStateConstants } from './state_constants';

export enum CHANNEL_TYPE {
  DEMO = 'DEMO',
  NORMAL = 'NORMAL',
}

export enum ENTRYPOINT_TYPE {
  PUSH = 'PUSH',
  PULL = 'PULL',
}

export interface PodFilters {
  /** Selected state code, if any e.g. FL, NC, OH */
  stateCode: string;
  /** Selected filter type, if any */
  channelType: CHANNEL_TYPE;
}

export type ChannelInfo = {
  // Slack cannel ID -- e.g. G12345678, may not exist if mismatch between Redis and Slack
  id?: string;
  // Channel Name, e.g. north-carolina
  name: string;
  // State code, e.g. NC
  stateCode: string;
  // List of open entrypoints
  entrypoints: ENTRYPOINT_TYPE[];
};

function getRedisKeyWithStateName(
  stateNameNoSpaces: string,
  channelType: CHANNEL_TYPE,
  entryPointType: ENTRYPOINT_TYPE
) {
  const entrypointString =
    entryPointType === ENTRYPOINT_TYPE.PULL ? 'Pull' : 'Push';
  switch (channelType) {
    case CHANNEL_TYPE.NORMAL:
      return `openPods${entrypointString}${stateNameNoSpaces}`;
    case CHANNEL_TYPE.DEMO:
      return `openPods${entrypointString}Demo${stateNameNoSpaces}`;
  }
  throw new Error(`Unexpected channelType: ${channelType}`);
}

function getRedisKeyWithStateCode(
  stateCode: string,
  channelType: CHANNEL_TYPE,
  entryPointType: ENTRYPOINT_TYPE
) {
  const stateName = getStateConstants()[stateCode];
  const stateNameNoSpaces = stateName.replace(/\s/g, '');
  return getRedisKeyWithStateName(
    stateNameNoSpaces,
    channelType,
    entryPointType
  );
}

export function getChannelNamePrefixForState(
  stateCode: string,
  channelType: CHANNEL_TYPE
): string {
  const stateName = getStateConstants()[stateCode];
  const stateNameHyphens = stateName.toLowerCase().replace(/\s/g, '-');
  switch (channelType) {
    case CHANNEL_TYPE.NORMAL:
      return `${stateNameHyphens}-`;
    case CHANNEL_TYPE.DEMO:
      return `demo-${stateNameHyphens}-`;
  }
  throw new Error(`Unexpected channelType: ${channelType}`);
}

export async function getPodChannelState(
  redisClient: PromisifiedRedisClient,
  filters: PodFilters
): Promise<ChannelInfo[]> {
  // Map from channel names to a state
  const ret: Record<string, ChannelInfo> = {};

  // Get all channels from Redis cache or Slack API
  const channelNamesAndIds =
    (await SlackApiUtil.getSlackChannelNamesAndIds(redisClient)) || {};

  // Get list of open channels from Redis matching state + entrypoint type
  const [openPullChannels, openPushChannels] = await Promise.all([
    redisClient.lrangeAsync(
      getRedisKeyWithStateCode(
        filters.stateCode,
        filters.channelType,
        ENTRYPOINT_TYPE.PULL
      ),
      0,
      -1
    ),
    redisClient.lrangeAsync(
      getRedisKeyWithStateCode(
        filters.stateCode,
        filters.channelType,
        ENTRYPOINT_TYPE.PUSH
      ),
      0,
      -1
    ),
  ]);

  // Make default channel info object
  const makeChannelInfo = (channelName: string) => ({
    id: channelNamesAndIds[channelName],
    name: channelName,
    stateCode: filters.stateCode,
    entrypoints: [],
  });

  // Calculate state
  openPullChannels.forEach((channelName) => {
    ret[channelName] = ret[channelName] || makeChannelInfo(channelName);
    ret[channelName].entrypoints.push(ENTRYPOINT_TYPE.PUSH);
  });
  openPushChannels.forEach((channelName) => {
    ret[channelName] = ret[channelName] || makeChannelInfo(channelName);
    ret[channelName].entrypoints.push(ENTRYPOINT_TYPE.PULL);
  });

  // Go through any remaining channels in our list and record them as closed
  // since they're not in our Redis list
  Object.keys(channelNamesAndIds).forEach((channelName: string) => {
    if (
      channelName.startsWith(
        getChannelNamePrefixForState(filters.stateCode, filters.channelType)
      )
    )
      ret[channelName] = ret[channelName] || makeChannelInfo(channelName);
  });

  return sortBy(ret, 'name');
}

export async function setChannelState(
  redisClient: PromisifiedRedisClient,
  {
    stateCode,
    channelName,
    entrypoints,
  }: {
    stateCode: string;
    channelName: string;
    entrypoints: ENTRYPOINT_TYPE[];
  }
): Promise<void> {
  logger.info(
    `PodUtil.setChannelState called: ${JSON.stringify({
      stateCode,
      channelName,
      entrypoints,
    })}`
  );
  const isDemo = channelName.startsWith('demo-');
  const channelType = isDemo ? CHANNEL_TYPE.DEMO : CHANNEL_TYPE.NORMAL;

  const pullKey = getRedisKeyWithStateCode(
    stateCode,
    channelType,
    ENTRYPOINT_TYPE.PULL
  );
  const pushKey = getRedisKeyWithStateCode(
    stateCode,
    channelType,
    ENTRYPOINT_TYPE.PUSH
  );

  // Remove before pushing to avoid duplicates. There is stil a chance of a race condition
  // creating a duplicate though. An occasional duplicate is probably fine (it just means
  // some channels get hit more often in the load balancer) but to fix, we'll have to migrate
  // all of the lists used to track open + closed channels to using Redis sets instead.
  await Promise.all([
    (async () => {
      await redisClient.lremAsync(pullKey, 0, channelName);
      if (entrypoints.includes(ENTRYPOINT_TYPE.PULL)) {
        await redisClient.rpushAsync(pullKey, [channelName]);
      }
    })(),
    (async () => {
      await redisClient.lremAsync(pushKey, 0, channelName);
      if (entrypoints.includes(ENTRYPOINT_TYPE.PUSH)) {
        await redisClient.rpushAsync(pushKey, [channelName]);
      }
    })(),
  ]);
}

// We can only embed a single string value for dropdown selection to identify both channel
// + code + state
export function getBlockId(stateCode: string, channelName: string): string {
  return `${OPEN_CLOSE_CHANNELS_BLOCK_ID_PREFIX}${stateCode}:${channelName}`;
}

// Parse string generated by getDropdownValue
export function parseBlockId(
  value = ''
): { stateCode: string; channelName: string } {
  if (!value.startsWith(OPEN_CLOSE_CHANNELS_BLOCK_ID_PREFIX)) {
    throw new Error(`PodUtil.parseBlockId: Unexpected value ${value}`);
  }

  const [stateCode, channelName] = value
    .slice(OPEN_CLOSE_CHANNELS_BLOCK_ID_PREFIX.length)
    .split(':');
  return {
    stateCode,
    channelName,
  };
}
