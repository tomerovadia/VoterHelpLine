const fieldTypes = {
  // Not necessary (is default)
  userId: "string",
  isDemo: "boolean",
  confirmedDisclaimer: "boolean",
  lastVoterMessageSecsFromEpoch: "integer",
};

exports.setHash = (redisClient, key, hash) => {
  let promise;
  for (const field in hash) {
    let value = hash[field];
    promise = redisClient.hsetAsync(key, field, value);
  }
  return promise;
};

exports.getHash = (redisClient, key) => {
  return redisClient.hgetallAsync(key).then(hash => {
    if (hash != null) {
      for (let field in hash) {
        switch(fieldTypes[field]) {
          case "boolean":
            hash[field] = hash[field] === "true";
            break;
          case "integer":
            hash[field] = parseInt(hash[field]);
            break;
          default:
            break;
        }
      }
    }
    return new Promise(resolve => resolve(hash));
  });
};
