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

  return Promise.all(Object.keys(hash).map(field => {
    const value = hash[field];

    return redisClient.hsetAsync(key, field, value);
  }));
};

exports.getHash = async (redisClient, key) => {
  if (logDebug) console.log(`\nENTERING REDISAPIUTIL.getHash`);
  const hash = await redisClient.hgetallAsync(key);
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

  return hash;
};

exports.getHashField = async (redisClient, key, field) => {
  if (logDebug) console.log(`\nENTERING REDISAPIUTIL.getHashField`);

  const value = await redisClient.hgetAsync(key, field);
  if (value != null) {
    switch(fieldTypes[field]) {
      case "boolean":
        return hash[field] === "true";
        break;
      case "integer":
        return parseInt(hash[field]);
        break;
      default:
        return value;
    }
  }
};

exports.deleteHashField = (redisClient, key, field) => {
  if (logDebug) console.log(`\nENTERING REDISAPIUTIL.deleteHashField`);

  return redisClient.hdelAsync(key, field);
};
