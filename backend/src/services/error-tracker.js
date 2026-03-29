const axios = require('axios');
const logger = require('../utils/logger');

const isEnabled = () => {
  if (process.env.ERROR_TRACKING_ENABLED === 'false') {
    return false;
  }
  return process.env.NODE_ENV === 'production';
};

const captureException = async (error, context = {}) => {
  if (!error) {
    return;
  }

  const payload = {
    level: 'error',
    source: 'backend',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    message: error.message || 'Unknown error',
    name: error.name || 'Error',
    stack: error.stack,
    context
  };

  logger.error('Unhandled exception captured', { error, context });

  const webhookUrl = String(process.env.ERROR_WEBHOOK_URL || '').trim();
  if (!isEnabled() || !webhookUrl) {
    return;
  }

  try {
    await axios.post(webhookUrl, payload, { timeout: 4000 });
  } catch (sendError) {
    logger.warn('Failed to send error event to webhook', {
      webhookUrl,
      error: sendError
    });
  }
};

module.exports = {
  captureException
};
