const ENTRY_POINT_TYPE = "Pull";

exports.selectChannelByRoundRobin = (redisClient, isDemo, stateName) => {
  const stateNameNoSpace = stateName.replace(/\s/g, '');
  const demoString = isDemo ? "Demo" : "";

  // Key to Redis values of number of voters must follow this format.
  const voterCounterKey = `voterCounter${demoString}${stateNameNoSpace}`;
  // Keys to Redis lists of open pods must follow this format.
  const openPodsKey = `open${ENTRY_POINT_TYPE}${demoString}${stateNameNoSpace}Pods`;

  console.log(openPodsKey);

  return redisClient.getAsync(voterCounterKey).then((numVoters, err) => {
    if (err) console.log("LoadBalancer: Error! Couldn't find openPodsKey in Redis:", err);
    return redisClient.lrangeAsync(openPodsKey, "0", "1000" /* max # of pods */).then((openPods, err) => {
      if (err) {
        console.log("LoadBalancer: Error! Couldn't find openPodsKey in Redis:", err);
        return;
      }

      numVoters = parseInt(numVoters);
      const selectedPodNumber = numVoters % openPods.length;
      const selectedChannelName = openPods[selectedPodNumber];

      redisClient.setAsync(voterCounterKey, numVoters + 1);

      return new Promise(resolve => resolve(selectedChannelName));
    }).catch(err => console.log("LoadBalancer: Error selecting a channel:", err));
  }).catch(err => console.log("LoadBalancer: Error selecting a channel:", err));;
};
