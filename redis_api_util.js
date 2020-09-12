const logDebug = process.env.NODE_ENV !== "test";

const fieldTypes = {
  // Not necessary (is default)
  userId: "string",
  isDemo: "boolean",
  confirmedDisclaimer: "boolean",
  volunteerEngaged: "boolean",
  lastVoterMessageSecsFromEpoch: "integer",
};

exports.setHash = (redisClient, key, hash) => {
  if (logDebug) console.log(`\nENTERING REDISAPIUTIL.setHash`);
  let promise;
  for (const field in hash) {
    let value = hash[field];
    promise = redisClient.hsetAsync(key, field, value).catch(err => {
      if (logDebug) console.log(`REDISAPIUTIL.setHash: ERROR calling hsetAsync`, err);
    });
  }
  return promise;
};

exports.getHash = (redisClient, key) => {
  if (logDebug) console.log(`\nENTERING REDISAPIUTIL.getHash`);
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
  }).catch(err => {
    if (logDebug) console.log(`REDISAPIUTIL.setHash: ERROR calling hgetallAsync`, err);
  });
};
