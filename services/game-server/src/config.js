const DEFAULT_DEV_PORT = 8787;

/**
 * @typedef {object} ServerConfig
 * @property {number} port
 * @property {string[]} allowedOrigins
 * @property {string} insforgeBaseUrl
 * @property {string} publicAppOrigin
 * @property {'test'|'insforge'} wsAuthMode
 * @property {string} testToken
 * @property {string} logLevel
 * @property {string} [insforgeApiKey]
 * @property {boolean} isProduction
 * @property {number} maxMessageBytes
 * @property {number} maxMessagesPerSecond
 * @property {number} heartbeatIntervalMs
 * @property {number} heartbeatTimeoutMs
 * @property {number} tickHz
 * @property {number} snapshotHz
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {ServerConfig}
 */
export function loadConfig(env = process.env) {
  const isProduction = env.NODE_ENV === 'production';
  const portRaw = env.PORT;
  const port = Number(portRaw || (isProduction ? NaN : DEFAULT_DEV_PORT));
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(isProduction ? 'PORT is required in production' : 'PORT must be a positive integer');
  }

  const allowedOrigins = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (isProduction && allowedOrigins.length === 0) {
    throw new Error('ALLOWED_ORIGINS is required in production (comma-separated, no wildcards)');
  }
  if (isProduction && allowedOrigins.includes('*')) {
    throw new Error('ALLOWED_ORIGINS must not include * in production');
  }

  if (!isProduction) {
    for (const local of ['http://localhost:4321', 'http://127.0.0.1:4321', 'http://localhost:8787']) {
      if (!allowedOrigins.includes(local)) allowedOrigins.push(local);
    }
  }

  const wsAuthModeRaw = (env.WS_AUTH_MODE || '').trim().toLowerCase();
  /** @type {'test'|'insforge'} */
  let wsAuthMode;
  if (wsAuthModeRaw === 'test') {
    if (isProduction) {
      throw new Error('WS_AUTH_MODE=test is not allowed in production');
    }
    wsAuthMode = 'test';
  } else if (wsAuthModeRaw === 'insforge' || wsAuthModeRaw === '') {
    // Empty defaults to insforge so production never silently opens test auth.
    wsAuthMode = 'insforge';
  } else {
    throw new Error(`Unsupported WS_AUTH_MODE: ${wsAuthModeRaw}`);
  }

  const testToken = env.WS_TEST_TOKEN || 'golazo-local-test-token';
  if (wsAuthMode === 'test' && !testToken) {
    throw new Error('WS_TEST_TOKEN is required when WS_AUTH_MODE=test');
  }

  const insforgeBaseUrl = (env.INSFORGE_BASE_URL || '').replace(/\/$/, '');
  if (wsAuthMode === 'insforge' && !insforgeBaseUrl) {
    throw new Error('INSFORGE_BASE_URL is required when WS_AUTH_MODE=insforge');
  }

  const publicAppOrigin = (env.PUBLIC_APP_ORIGIN || '').replace(/\/$/, '');
  if (isProduction && !publicAppOrigin) {
    throw new Error('PUBLIC_APP_ORIGIN is required in production');
  }

  const logLevel = (env.LOG_LEVEL || 'info').toLowerCase();
  const insforgeApiKey = env.INSFORGE_API_KEY || undefined;

  return {
    port,
    allowedOrigins,
    insforgeBaseUrl,
    publicAppOrigin: publicAppOrigin || 'http://localhost:4321',
    wsAuthMode,
    testToken,
    logLevel,
    insforgeApiKey,
    isProduction,
    maxMessageBytes: Number(env.MAX_MESSAGE_BYTES || 4096),
    maxMessagesPerSecond: Number(env.MAX_MESSAGES_PER_SECOND || 30),
    heartbeatIntervalMs: Number(env.HEARTBEAT_INTERVAL_MS || 15000),
    heartbeatTimeoutMs: Number(env.HEARTBEAT_TIMEOUT_MS || 45000),
    tickHz: Number(env.MATCH_TICK_HZ || 20),
    snapshotHz: Number(env.MATCH_SNAPSHOT_HZ || 15),
  };
}

/**
 * @param {string|undefined} origin
 * @param {ServerConfig} config
 */
export function isOriginAllowed(origin, config) {
  if (!origin) {
    // Non-browser clients (curl, scripts) may omit Origin.
    return !config.isProduction;
  }
  return config.allowedOrigins.includes(origin);
}
