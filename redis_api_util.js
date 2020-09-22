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
      if (logDebug) console.log('\x1b[41m%s\x1b[1m\x1b[0m', `REDISAPIUTIL.setHash: ERROR calling hsetAsync`, err);
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
    if (logDebug) console.log('\x1b[41m%s\x1b[1m\x1b[0m', `REDISAPIUTIL.setHash: ERROR calling hgetallAsync`, err);
  });
};

exports.getHashField = (redisClient, key, field) => {
  if (logDebug) console.log(`\nENTERING REDISAPIUTIL.getHashField`);
  let parsedValue;
  return redisClient.hgetAsync(key, field).then(value => {
    if (value != null) {
      switch(fieldTypes[field]) {
        case "boolean":
          parsedValue = hash[field] === "true";
          break;
        case "integer":
          parsedValue = parseInt(hash[field]);
          break;
        default:
          parsedValue = value;
      }
    }
    return new Promise(resolve => resolve(parsedValue));
  }).catch(err => {
    if (logDebug) console.log('\x1b[41m%s\x1b[1m\x1b[0m', `REDISAPIUTIL.getHashField: ERROR calling hgetAsync`, err);
  });
};

exports.deleteHashField = (redisClient, key, field) => {
  if (logDebug) console.log(`\nENTERING REDISAPIUTIL.deleteHashField`);
  return redisClient.hdelAsync(key, field).then(value => {
    return new Promise(resolve => resolve(value));
  }).catch(err => {
    if (logDebug) console.log('\x1b[41m%s\x1b[1m\x1b[0m', `REDISAPIUTIL.deleteHashField: ERROR calling hdelAsync`, err);
  });
};
