import { difference, uniq } from 'lodash';
import { getStateConstants } from './state_constants';
import { PromisifiedRedisClient } from './redis_client';
import * as RedisApiUtil from './redis_api_util';

type StateRegionConfig = {
  [stateName: string]: string; // mapping of U.S. state name to entrypoint name (region/state name)
};

export async function fetchStateRegionConfig(
  redisClient: PromisifiedRedisClient
): Promise<StateRegionConfig | null> {
  const stateRegionConfig = await RedisApiUtil.getHash(
    redisClient,
    'stateRegionConfig'
  );
  if (stateRegionConfig) return stateRegionConfig;
  return null;
}

export const regionsList =
  process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA'
    ? uniq(Object.values(fetchStateRegionConfig()))
    : [];

export const regionsListMinusStates = difference(
  regionsList,
  Object.values(getStateConstants())
);
