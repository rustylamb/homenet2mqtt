export const logger = {
  info: console.log,
  warn: console.warn,
  error: console.error,
  debug: () => {}, // Disable debug for benchmark
  isLevelEnabled: () => false,
  child: () => logger
};
export const logBuffer = { add: () => {} };
