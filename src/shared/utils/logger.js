import { logger } from 'firebase-functions';

// Global variable to control logging
let LOGGING_ENABLED = true; // Default to true unless explicitly set to 'false'

const log = {
  // Info level logs
  info: (...args) => {
    if (LOGGING_ENABLED) {
      logger.log(...args);
    }
  },
  
  // Debug level logs (only in development)
  debug: (...args) => {
    if (LOGGING_ENABLED ) {
      logger.debug(...args);
    }
  },
  
  // Warning level logs
  warn: (...args) => {
    if (LOGGING_ENABLED) {
      logger.warn(...args);
    }
  },
  
  // Error level logs (always logged regardless of LOGGING_ENABLED)
  error: (...args) => {
    logger.error(...args);
  },
  
  // Set logging enabled/disabled
  setEnabled: (enabled) => {
    LOGGING_ENABLED = enabled;
  },
  
  // Check if logging is enabled
  isEnabled: () => LOGGING_ENABLED
};

export default logger;
