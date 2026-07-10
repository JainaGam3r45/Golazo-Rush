import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createGameServer } from './server.js';

const config = loadConfig();
const log = createLogger(config.logLevel);

const game = await createGameServer({ config, log });
await game.listen();

async function shutdown(signal) {
  log.info('signal', { signal });
  try {
    await game.close();
    process.exit(0);
  } catch (err) {
    log.error('shutdown_failed', { err: err?.message });
    process.exit(1);
  }
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
