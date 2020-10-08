import { deduplicationRedisClient } from './redis_client';
import * as Sentry from '@sentry/node';

const DEDUPE_WINDOW_SECONDS = 60 * 60;

/**
 * Implements redis-backed deduplication. The first time this is called with
 * a given key, it will return true. After that, it will return false until
 * the key expires in 1 hour.
 *
 * If there's an error talking to redis, it will return true (erring on the
 * side of permitting duplication if there's a problem with Redis).
 */
export default async function deduplicate(key: string): Promise<boolean> {
  try {
    const res = await deduplicationRedisClient.setAsync(
      `deduplication:${key}`,
      'true',
      'EX',
      DEDUPE_WINDOW_SECONDS,
      'NX'
    );

    if (res) {
      return true;
    } else {
      return false;
    }
  } catch (err) {
    logger.warn(`DEDUPLICATION: failed deduplicate message with key ${key}`);
    logger.warn(err);
    Sentry.captureException(err);
    return true;
  }
}
