const serializeError = (error) => {
  if (!error) return undefined;
  return {
    name: error.name,
    message: error.message,
    stack: error.stack
  };
};

const cleanMetadata = (metadata = {}) => {
  const output = {};
  Object.entries(metadata).forEach(([key, value]) => {
    if (value === undefined) {
      return;
    }
    if (value instanceof Error) {
      output[key] = serializeError(value);
      return;
    }
    output[key] = value;
  });
  return output;
};

const log = (level, message, metadata = {}) => {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    service: 'trail-map-backend',
    ...cleanMetadata(metadata)
  };

  const line = JSON.stringify(payload);
  if (level === 'error' || level === 'warn') {
    console.error(line);
    return;
  }
  console.log(line);
};

module.exports = {
  debug: (message, metadata) => log('debug', message, metadata),
  info: (message, metadata) => log('info', message, metadata),
  warn: (message, metadata) => log('warn', message, metadata),
  error: (message, metadata) => log('error', message, metadata)
};
