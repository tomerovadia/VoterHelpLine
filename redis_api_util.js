const logger = require('./logger');

const fieldTypes = {
  // Not necessary (is default)
  userId: "string",
  isDemo: "boolean",
  confirmedDisclaimer: "boolean",
  volunteerEngaged: "boolean",
  lastVoterMessageSecsFromEpoch: "integer",
};

exports.setHash = (redisClient, key, hash) => {
  logger.debug(`ENTERING REDISAPIUTIL.setHash`);

  return Promise.all(Object.keys(hash).map(field => {
    const value = hash[field];

    return redisClient.hsetAsync(key, field, value);
  }));
};

exports.getHash = async (redisClient, key) => {
  logger.debug(`ENTERING REDISAPIUTIL.getHash`);
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
  logger.debug(`ENTERING REDISAPIUTIL.getHashField`);

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
  logger.debug(`ENTERING REDISAPIUTIL.deleteHashField`);

  return redisClient.hdelAsync(key, field);
};
