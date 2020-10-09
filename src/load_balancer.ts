import logger from './logger';
import { PromisifiedRedisClient } from './redis_client';
import { EntryPoint } from './types';
import * as StateRegionConfig from './state_region_config';

export const PULL_ENTRY_POINT = 'PULL';
export const PUSH_ENTRY_POINT = 'PUSH';

// phoneNumbersAreDemo stores hardcoded logic determining whether a pull
// voter should be considered a demo, based on the twilioPhoneNumber and
// userPhoneNumber.
export function phoneNumbersAreDemo(
  twilioPhoneNumber: string,
  userPhoneNumber: string
): boolean {
  return (
    twilioPhoneNumber == process.env.DEMO_PHONE_NUMBER ||
    twilioPhoneNumber == process.env.PREVIOUS_DEMO_PHONE_NUMBER ||
    userPhoneNumber == process.env.TESTER_PHONE_NUMBER
  );
}

// getPushPhoneNumberState stores hardcoded logic determining the U.S. state of
// a push voter. Each push twilioPhoneNumber should only be used for one U.S. state.
export function getPushPhoneNumberState(
  twilioPhoneNumber: string
): string | null {
  switch (twilioPhoneNumber) {
    case process.env.PUSH_NC_PHONE_NUMBER:
      return 'North Carolina';
    default:
      return null;
  }
}

export async function selectSlackChannel(
  redisClient: PromisifiedRedisClient,
  entryPoint: EntryPoint,
  stateName?: string | null,
  isDemo = false
): Promise<string | null> {
  logger.debug('ENTERING LOADBALANCER.selectSlackChannel');
  logger.debug(
    `LOADBALANCER.selectSlackChannel: LoadBalancer given the following arguments: entryPoint: ${entryPoint}, stateName: ${stateName}, isDemo: ${isDemo}`
  );
  // If for some reason there's no stateName, Redis won't be able to provide
  // the needed info for determining a Slack channel. Caller should default
  // to #national-0 or #demo-national-0.
  if (!stateName) {
    logger.debug(
      'LOADBALANCER.selectSlackChannel: U.S. state not provided, LoadBalancer returning null.'
    );
    return null;
  }

  // Default to stateName;
  let stateOrRegionName = stateName;
  // Translate stateName potentially into a region.
  if (process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA') {
    const selectedRegionOrState = StateRegionConfig.stateToRegionMap[stateName];
    if (selectedRegionOrState) {
      stateOrRegionName = selectedRegionOrState;
    } else {
      logger.error(
        `LOADBALANCER.selectSlackChannel: ERROR with stateToRegionMap: no value found for key (${stateName}).`
      );
    }
  }

  if (!stateOrRegionName) {
    logger.error(
      `LOADBALANCER.selectSlackChannel: ERROR converting stateName (${stateName}) to region.`
    );
    return null;
  }

  const stateOrRegionNameNoSpace = stateOrRegionName.replace(/\s/g, '');
  const demoString = isDemo ? 'Demo' : '';
  const entryPointString = entryPoint === PULL_ENTRY_POINT ? 'Pull' : 'Push';

  // Key to Redis values of number of voters must follow this format.
  const voterCounterKey = `voterCounter${entryPointString}${demoString}${stateOrRegionNameNoSpace}`;
  logger.debug(
    `LOADBALANCER.selectSlackChannel: Determined voterCounterKey: ${voterCounterKey}`
  );
  // Keys to Redis lists of open pods must follow this format.
  const openPodsKey = `openPods${entryPointString}${demoString}${stateOrRegionNameNoSpace}`;
  logger.debug(
    `LOADBALANCER.selectSlackChannel: Determined openPodsKey: ${openPodsKey}`
  );

  const numVotersFromRedis = await redisClient.getAsync(voterCounterKey);
  let numVoters;
  if (!numVotersFromRedis) {
    logger.debug('No value for voterCounterKey; assuming 0');
    numVoters = 0;
  } else {
    numVoters = Number(numVotersFromRedis);
  }

  logger.debug(
    `LOADBALANCER.selectSlackChannel: Successfully found numVoters with voterCounterKey ${voterCounterKey} in Redis: ${numVoters}`
  );

  const openPods = await redisClient.lrangeAsync(
    openPodsKey,
    0,
    1000 /* max # of pods */
  );
  if (!openPods) {
    logger.error(
      `LOADBALANCER.selectSlackChannel: ERROR finding openPodsKey ${openPodsKey} in Redis: err || !openPods`
    );
    return null;
  }

  logger.debug(
    `LOADBALANCER.selectSlackChannel: Successfully found openPods with openPodsKey ${openPodsKey} in Redis: ${JSON.stringify(
      openPods
    )}`
  );

  const selectedPodNumber = numVoters % openPods.length;
  logger.debug(
    `LOADBALANCER.selectSlackChannel: selectedPodNumber = numVoters % openPods.length = ${numVoters} % ${openPods.length} = ${selectedPodNumber}`
  );

  const selectedChannelName = openPods[selectedPodNumber];
  logger.debug(
    `LOADBALANCER.selectSlackChannel: selectedChannelName = openPods[selectedPodNumber] = ${openPods}[${selectedPodNumber}] = ${selectedChannelName}`
  );

  logger.debug(
    `LOADBALANCER.selectSlackChannel: Updating Redis voterCounterKey ${voterCounterKey} from ${numVoters} to ${
      numVoters + 1
    }`
  );
  await redisClient.setAsync(voterCounterKey, numVoters + 1);

  logger.debug(
    `Exiting LOADBALANCER.selectSlackChannel with return value: ${selectedChannelName}`
  );
  return selectedChannelName;
}
