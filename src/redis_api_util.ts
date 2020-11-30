import bluebird from 'bluebird';
import { Multi } from 'redis';
import logger from './logger';
import { PromisifiedRedisClient } from './redis_client';

const fieldTypes: {
  [fieldName: string]: 'string' | 'boolean' | 'integer' | undefined;
} = {
  // Not necessary (is default)
  userId: 'string',
  isDemo: 'boolean',
  confirmedDisclaimer: 'boolean',
  volunteerEngaged: 'boolean',
  lastVoterMessageSecsFromEpoch: 'integer',
};

export function setHash(
  redisClient: PromisifiedRedisClient,
  key: string,
  hash: { [k: string]: string | number }
): Promise<void[]> {
  logger.debug(`ENTERING REDISAPIUTIL.setHash`);

  return Promise.all(
    Object.keys(hash).map((field) => {
      const value = hash[field];

      return redisClient.hsetAsync(key, field, value);
    })
  );
}

export async function getHash(
  redisClient: PromisifiedRedisClient,
  key: string
): Promise<{
  [k: string]: any;
}> {
  logger.debug(`ENTERING REDISAPIUTIL.getHash`);
  const hash: {
    [k: string]: any;
  } = await redisClient.hgetallAsync(key);
  if (hash != null) {
    for (const field in hash) {
      switch (fieldTypes[field]) {
        case 'boolean':
          hash[field] = hash[field] === 'true';
          break;
        case 'integer':
          hash[field] = parseInt(hash[field]);
          break;
        default:
          break;
      }
    }
  }

  return hash;
}

export async function getHashField(
  redisClient: PromisifiedRedisClient,
  key: string,
  field: string
): Promise<any> {
  logger.debug(`ENTERING REDISAPIUTIL.getHashField`);

  const value = await redisClient.hgetAsync(key, field);
  if (value != null) {
    switch (fieldTypes[field]) {
      case 'boolean':
        return value === 'true';
      case 'integer':
        return parseInt(value);
      default:
        return value;
    }
  }
}

export function deleteHashField(
  redisClient: PromisifiedRedisClient,
  key: string,
  field: string
): Promise<number> {
  logger.debug(`ENTERING REDISAPIUTIL.deleteHashField`);

  return redisClient.hdelAsync(key, field);
}

export function getKey(
  redisClient: PromisifiedRedisClient,
  key: string
): Promise<string> {
  logger.debug(`ENTERING REDISAPIUTIL.getKey`);

  return redisClient.getAsync(key);
}

export function keysExist(
  redisClient: PromisifiedRedisClient,
  keys: string[]
): Promise<number> {
  logger.debug(`ENTERING REDISAPIUTIL.keysExist`);

  return redisClient.existsAsync(...keys);
}

export function deleteKeys(
  redisClient: PromisifiedRedisClient,
  keys: string[]
): Promise<number> {
  logger.debug(`ENTERING REDISAPIUTIL.deleteKeys`);

  return redisClient.delAsync(...keys);
}

export async function transactAsync(
  redisClient: PromisifiedRedisClient,
  callback: (multi: Multi) => Multi
): Promise<any[]> {
  const multi = callback(redisClient.multi());
  return bluebird.promisify(multi.exec.bind(multi))();
}
