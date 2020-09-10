const PULL_ENTRY_POINT = "PULL";
const PUSH_ENTRY_POINT = "PUSH";
exports.PULL_ENTRY_POINT = PULL_ENTRY_POINT;
exports.PUSH_ENTRY_POINT = PUSH_ENTRY_POINT;

// phoneNumbersAreDemo stores hardcoded logic determining whether a pull
// voter should be considered a demo, based on the twilioPhoneNumber and
// userPhoneNumber.
exports.phoneNumbersAreDemo = (twilioPhoneNumber, userPhoneNumber) => {
  return twilioPhoneNumber == process.env.DEMO_PHONE_NUMBER ||
      twilioPhoneNumber == process.env.PREVIOUS_DEMO_PHONE_NUMBER ||
      userPhoneNumber == process.env.TESTER_PHONE_NUMBER;
};

// getPushPhoneNumberState stores hardcoded logic determining the U.S. state of
// a push voter. Each push twilioPhoneNumber should only be used for one U.S. state.
exports.getPushPhoneNumberState = (twilioPhoneNumber) => {
  switch(twilioPhoneNumber) {
    case process.env.PUSH_NC_PHONE_NUMBER:
      return "North Carolina";
    default:
      return null;
  }
}

exports.selectSlackChannel = (redisClient, entryPoint, stateName, isDemo = false) => {
  // If for some reason there's no stateName, Redis won't be able to provide
  // the needed info for determining a Slack channel. Caller should default
  // to #lobby.
  if (!stateName) return null;
  const stateNameNoSpace = stateName.replace(/\s/g, '');
  const demoString = isDemo ? "Demo" : "";
  const entryPointString = entryPoint === PULL_ENTRY_POINT ? "Pull" : "Push";

  // Key to Redis values of number of voters must follow this format.
  const voterCounterKey = `voterCounter${entryPointString}${demoString}${stateNameNoSpace}`;
  // Keys to Redis lists of open pods must follow this format.
  const openPodsKey = `openPods${entryPointString}${demoString}${stateNameNoSpace}`;

  console.log(`LoadBalancer: Checking Redis for ${voterCounterKey}.`)
  console.log(`LoadBalancer: Checking Redis for ${openPodsKey}.`)

  return redisClient.getAsync(voterCounterKey).then((numVoters, err) => {
    if (err || !numVoters) console.log(`LoadBalancer: Error! Couldn't find ${voterCounterKey} voterCounterKey in Redis:`, err);
    return redisClient.lrangeAsync(openPodsKey, 0, 1000 /* max # of pods */).then((openPods, err) => {
      if (err || !openPods) {
        console.log(`LoadBalancer: Error! Couldn't find ${openPodsKey} openPodsKey in Redis:`, err);
        return null;
      }

      numVoters = parseInt(numVoters);
      const selectedPodNumber = numVoters % openPods.length;
      const selectedChannelName = openPods[selectedPodNumber];

      redisClient.setAsync(voterCounterKey, numVoters + 1);

      return new Promise(resolve => resolve(selectedChannelName));
    }).catch(err => console.log("LoadBalancer: Error selecting a channel:", err));
  }).catch(err => console.log("LoadBalancer: Error selecting a channel:", err));;
};
