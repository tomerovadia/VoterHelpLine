import bluebird from 'bluebird';
import redis from 'redis';
import * as Sentry from '@sentry/node';

import logger from './logger';

// Bluebird creates xxxAsync methods.
// https://github.com/NodeRedis/node_redis
bluebird.promisifyAll(redis);
const redisClient = redis.createClient(process.env.REDISCLOUD_URL as string);

redisClient.on('error', function (err) {
  logger.info('Redis client error', err);
  Sentry.captureException(err);
});

// Typescript doesn't understand promisifyAll, so we explicity declare the
// xxxAsync methods we use
export type PromisifiedRedisClient = typeof redisClient & {
  getAsync(key: string): Promise<string>;
  lrangeAsync(key: string, from: number, to: number): Promise<string[]>;
  rpushAsync(key: string, from: string[]): Promise<number>;
  setAsync(key: string, value: string | number): Promise<void>;
  hgetallAsync(key: string): Promise<{ [k: string]: string }>;
  hgetAsync(key: string, field: string): Promise<string>;
  hsetAsync(key: string, field: string, value: string | number): Promise<void>;
  existsAsync(...keys: string[]): Promise<number>;
  delAsync(...keys: string[]): Promise<number>;
  hdelAsync(key: string, field: string): Promise<number>;
  pingAsync(): Promise<void>;
};

export default redisClient as PromisifiedRedisClient;
