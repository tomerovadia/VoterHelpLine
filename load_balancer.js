exports.selectChannelByRoundRobin = (redisClient, isDemo, stateName) => {
  const stateNameNoSpace = stateName.replace(/\s/g, '');
  const demoString = isDemo? "Demo" : "";

  const numPodsKey = `numPods${demoString}${stateNameNoSpace}`;
  const voterCounterKey = `voterCounter${demoString}${stateNameNoSpace}`;

  return redisClient.mgetAsync(numPodsKey, voterCounterKey).then(response => {
    const numPods = parseInt(response[0]);
    const numVoters = parseInt(response[1]);
    const selectedPodNumber = numVoters % numPods;

    const selectedChannel = `${isDemo ? "demo-" : ""}${stateName.toLowerCase().replace(/\s/g, '-')}-${selectedPodNumber}`;

    redisClient.setAsync(voterCounterKey, numVoters + 1);

    return new Promise(resolve => resolve(selectedChannel));
  });
};
