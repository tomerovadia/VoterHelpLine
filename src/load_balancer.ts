import logger from './logger';
import { PromisifiedRedisClient } from './redis_client';
import { EntryPoint, UserInfo } from './types';
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

export function convertSlackChannelNameToStateOrRegionName(
  slackChannelName: string
): string {
  const slackChannelNameLowercase = slackChannelName
    .replace(/[0-9]|demo/g, '')
    .replace(/-/g, ' ')
    .trim();
  return slackChannelNameLowercase
    .split(' ')
    .map((word) => {
      // Because 'of' is not capitalized in District of Columbia.
      // TODO: capitalize it, so this edge case doesn't need to be caught.
      if (word === 'of') return word;
      return word[0].toUpperCase() + word.substring(1);
    })
    .join(' ');
}

export async function getJourneyChannel(
  redisClient: PromisifiedRedisClient,
  userInfo: UserInfo
): Promise<string> {
  const activeStateName = convertSlackChannelNameToStateOrRegionName(
    userInfo.activeChannelName
  );
  if (!activeStateName) {
    throw `Failed to parse state name from channel: *#${userInfo.activeChannelName}*. Please contact an admin.`;
  }
  const selectedSlackChannelName = await selectSlackChannel(
    redisClient,
    // We use PUSH to store open journey pods (PULL = frontline).
    'PUSH',
    activeStateName,
    userInfo.isDemo
  );
  // Either a stateName wasn't valid or Redis didn't provide open pods for the given stateName.
  if (
    !selectedSlackChannelName ||
    ['demo-national-0', 'national-0'].includes(selectedSlackChannelName)
  ) {
    throw `No journey pods found for U.S. state name: *${activeStateName}*. Please contact an admin.`;
  }
  if (userInfo.activeSlackChannelName === selectedSlackChannelName) {
    throw `The voter is already in an open journey pod for this U.S. state.`;
  }
  return selectedSlackChannelName;
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
  // the needed info for determining a Slack channel. Caller should consider defaulting
  // to #national-0 or #demo-national-0 if PULL (or give modal error if PUSH).
  if (!stateName) {
    logger.error(
      'LOADBALANCER.selectSlackChannel: U.S. state not provided, LoadBalancer returning null.'
    );
    return null;
  }

  // Default to stateName;
  let stateOrRegionName = stateName;
  // Translate stateName potentially into a region.
  if (process.env.CLIENT_ORGANIZATION === 'VOTE_AMERICA') {
    const stateRegionConfig = await StateRegionConfig.fetchStateRegionConfig(
      redisClient
    );
    if (stateRegionConfig && stateRegionConfig[stateName]) {
      stateOrRegionName = stateRegionConfig[stateName];
    } else {
      // If stateName is a region (possible when routing voter to journey),
      // then all is well. Otherwise, error and leave stateOrRegionName = stateName as fallback.
      if (stateRegionConfig && !stateRegionConfig.values.includes(stateName)) {
        logger.error(
          `LOADBALANCER.selectSlackChannel: ERROR with stateToRegionMap: no stateRegionConfig in Redis or no value found for key (${stateName}). stateRegionConfig: ${JSON.stringify(
            stateRegionConfig
          )}.`
        );
      }
    }
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

  let openPods = await redisClient.lrangeAsync(
    openPodsKey,
    0,
    -1 /* max # of pods */
  );
  if (!openPods || openPods.length === 0) {
    logger.error(
      `LOADBALANCER.selectSlackChannel: ERROR finding openPodsKey ${openPodsKey} in Redis: err || !openPods`
    );
    openPods = isDemo ? ['demo-national-0'] : ['national-0'];
  } else {
    logger.debug(
      `LOADBALANCER.selectSlackChannel: Successfully found openPods with openPodsKey ${openPodsKey} in Redis: ${JSON.stringify(
        openPods
      )}`
    );
  }

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
