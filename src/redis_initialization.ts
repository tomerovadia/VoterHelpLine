// This file is not imported by any other file in the checked in version.
// It is intended for use by developers for set-up, until it is no longer
// necessary.

import { PromisifiedRedisClient } from '../src/redis_client';
import { getStateConstants } from './state_constants';

// This function establishes initial open pods in Redis,
// populating demo and non-demo entry points and
// defaulting to the 0th open pod per entry point.
export async function initializeOpenPods(
  redisClient: PromisifiedRedisClient
): Promise<void> {
  const stateNames = Object.values(getStateConstants());
  stateNames.push('National');
  for (const idx in stateNames) {
    const stateName = stateNames[idx];
    const stateNameNoSpaces = stateName.replace(/\s/g, '');
    const stateNameHyphens = stateName.toLowerCase().replace(/\s/g, '-');

    const openPodsKey = `openPodsPull${stateNameNoSpaces}`;
    const openPodsValue = `${stateNameHyphens}-0`;
    await redisClient.delAsync(openPodsKey);
    await redisClient.rpushAsync(openPodsKey, [openPodsValue]);

    const openPodsDemoKey = `openPodsPullDemo${stateNameNoSpaces}`;
    const openPodsDemoValue = `demo-${stateNameHyphens}-0`;
    await redisClient.delAsync(openPodsDemoKey);
    await redisClient.rpushAsync(openPodsDemoKey, [openPodsDemoValue]);
  }
}
