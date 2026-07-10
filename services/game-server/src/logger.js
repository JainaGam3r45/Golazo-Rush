const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function nowIso() {
  return new Date().toISOString();
}

export function createLogger(levelName = 'info') {
  const threshold = LEVELS[levelName] ?? LEVELS.info;

  function write(level, msg, fields = {}) {
    if ((LEVELS[level] ?? 99) > threshold) return;
    const line = {
      ts: nowIso(),
      level,
      msg,
      ...fields,
    };
    const text = JSON.stringify(line);
    if (level === 'error') {
      process.stderr.write(`${text}\n`);
    } else {
      process.stdout.write(`${text}\n`);
    }
  }

  return {
    error: (msg, fields) => write('error', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    debug: (msg, fields) => write('debug', msg, fields),
  };
}

export function redactToken(token) {
  if (typeof token !== 'string' || token.length === 0) return '';
  if (token.length <= 8) return '***';
  return `${token.slice(0, 4)}…${token.slice(-2)}`;
}
