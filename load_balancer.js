const logger = require('./logger');

const PULL_ENTRY_POINT = 'PULL';
const PUSH_ENTRY_POINT = 'PUSH';
exports.PULL_ENTRY_POINT = PULL_ENTRY_POINT;
exports.PUSH_ENTRY_POINT = PUSH_ENTRY_POINT;

// phoneNumbersAreDemo stores hardcoded logic determining whether a pull
// voter should be considered a demo, based on the twilioPhoneNumber and
// userPhoneNumber.
exports.phoneNumbersAreDemo = (twilioPhoneNumber, userPhoneNumber) => {
  return (
    twilioPhoneNumber == process.env.DEMO_PHONE_NUMBER ||
    twilioPhoneNumber == process.env.PREVIOUS_DEMO_PHONE_NUMBER ||
    userPhoneNumber == process.env.TESTER_PHONE_NUMBER
  );
};

// getPushPhoneNumberState stores hardcoded logic determining the U.S. state of
// a push voter. Each push twilioPhoneNumber should only be used for one U.S. state.
exports.getPushPhoneNumberState = (twilioPhoneNumber) => {
  switch (twilioPhoneNumber) {
    case process.env.PUSH_NC_PHONE_NUMBER:
      return 'North Carolina';
    default:
      return null;
  }
};

exports.selectSlackChannel = async (
  redisClient,
  entryPoint,
  stateName,
  isDemo = false
) => {
  logger.debug('ENTERING LOADBALANCER.selectSlackChannel');
  logger.debug(
    `LOADBALANCER.selectSlackChannel: LoadBalancer given the following arguments: entryPoint: ${entryPoint}, stateName: ${stateName}, isDemo: ${isDemo}`
  );
  // If for some reason there's no stateName, Redis won't be able to provide
  // the needed info for determining a Slack channel. Caller should default
  // to #lobby.
  if (!stateName) {
    logger.debug(
      'LOADBALANCER.selectSlackChannel: U.S. state not provided, LoadBalancer returning null.'
    );
    return null;
  }
  const stateNameNoSpace = stateName.replace(/\s/g, '');
  const demoString = isDemo ? 'Demo' : '';
  const entryPointString = entryPoint === PULL_ENTRY_POINT ? 'Pull' : 'Push';

  // Key to Redis values of number of voters must follow this format.
  const voterCounterKey = `voterCounter${entryPointString}${demoString}${stateNameNoSpace}`;
  logger.debug(
    `LOADBALANCER.selectSlackChannel: Determined voterCounterKey: ${voterCounterKey}`
  );
  // Keys to Redis lists of open pods must follow this format.
  const openPodsKey = `openPods${entryPointString}${demoString}${stateNameNoSpace}`;
  logger.debug(
    `LOADBALANCER.selectSlackChannel: Determined openPodsKey: ${openPodsKey}`
  );

  let numVoters = await redisClient.getAsync(voterCounterKey);
  if (!numVoters) {
    logger.debug('No value for voterCounterKey; assuming 0');
    numVoters = 0;
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

  numVoters = parseInt(numVoters);

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
};
