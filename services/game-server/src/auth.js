import { createClient } from '@insforge/sdk';
import { redactToken } from './logger.js';

/**
 * @typedef {object} AuthIdentity
 * @property {string} userId
 * @property {string} [email]
 * @property {'test'|'insforge'} mode
 */

/**
 * @typedef {object} AuthVerifier
 * @property {(token: string) => Promise<AuthIdentity>} verify
 */

/**
 * Local-only verifier. Never enable in production.
 *
 * Accepted tokens:
 * - Exact `expectedToken` → userId `test-user`
 * - `test:<userId>` → distinct identities for two-client matches
 *
 * @param {string} expectedToken
 * @returns {AuthVerifier}
 */
export function createTestAuthVerifier(expectedToken) {
  return {
    async verify(token) {
      if (typeof token !== 'string' || !token) {
        const err = new Error('Missing token');
        err.code = 'UNAUTHORIZED';
        throw err;
      }
      if (token.startsWith('test:')) {
        const userId = token.slice('test:'.length).trim() || 'test-user';
        return { userId, mode: 'test' };
      }
      if (token === expectedToken) {
        return { userId: 'test-user', mode: 'test' };
      }
      const err = new Error('Invalid test token');
      err.code = 'UNAUTHORIZED';
      throw err;
    },
  };
}

/**
 * Production path: validate Bearer/JWT via InsForge SDK getCurrentUser.
 * @param {string} baseUrl
 * @returns {AuthVerifier}
 */
export function createInsForgeAuthVerifier(baseUrl) {
  return {
    async verify(token) {
      if (!token || typeof token !== 'string') {
        const err = new Error('Missing token');
        err.code = 'UNAUTHORIZED';
        throw err;
      }
      const client = createClient({ baseUrl, accessToken: token });
      const { data, error } = await client.auth.getCurrentUser();
      const userId = data?.user?.id ?? null;
      if (error || !userId) {
        const err = new Error('Invalid session');
        err.code = 'UNAUTHORIZED';
        throw err;
      }
      return {
        userId,
        email: data.user.email,
        mode: 'insforge',
      };
    },
  };
}

/**
 * @param {import('./config.js').ServerConfig} config
 * @param {ReturnType<import('./logger.js').createLogger>} log
 * @returns {AuthVerifier}
 */
export function createAuthVerifier(config, log) {
  if (config.wsAuthMode === 'test') {
    log.warn('auth_mode_test', { note: 'local only; use test:<userId> for distinct humans' });
    return createTestAuthVerifier(config.testToken);
  }
  log.info('auth_mode_insforge', { baseUrl: config.insforgeBaseUrl });
  return createInsForgeAuthVerifier(config.insforgeBaseUrl);
}

export { redactToken };
