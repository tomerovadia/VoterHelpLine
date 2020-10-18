import { difference, uniq } from 'lodash';
import { getStateConstants } from './state_constants';
import { PromisifiedRedisClient } from './redis_client';
import * as RedisApiUtil from './redis_api_util';

type StateRegionConfig = {
  [stateName: string]: string; // mapping of U.S. state name to entrypoint name (region/state name)
};

export async function fetchStateRegionConfig(
  redisClient: PromisifiedRedisClient
): Promise<StateRegionConfig> {
  const stateRegionConfig = await RedisApiUtil.getHash(
    redisClient,
    'stateRegionConfig'
  );
  if (stateRegionConfig) return stateRegionConfig;
  return {} as StateRegionConfig;
}

export async function regionsList(redisClient: PromisifiedRedisClient): Promise<string[]> {
  return process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA'
    ? uniq(Object.values(fetchStateRegionConfig(redisClient)))
    : [];
}

export async function getRegionsListMinusStates(redisClient: PromisifiedRedisClient): Promise<string[]> {
  const regions = await regionsList(redisClient);
  return difference(
    regions,
    Object.values(getStateConstants())
  );
}