/**
 * Structured JSON logging with the platform's mandatory fields (architecture 3.1).
 * Written straight to stdout as one JSON object per line: Lambda forwards such lines as-is,
 * so service, team, environment, version and correlation_id stay top-level fields (console.*
 * in Lambda's JSON log mode would nest them under "message").
 */
const context = {
  service: process.env.SERVICE ?? 'hello-node-lambda',
  team: process.env.TEAM ?? 'cargo',
  environment: process.env.ENVIRONMENT ?? 'local',
  version: process.env.VERSION ?? 'dev',
};

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[(process.env.AWS_LAMBDA_LOG_LEVEL ?? process.env.LOG_LEVEL ?? 'info').toLowerCase()] ?? 20;

export function logger(fields = {}) {
  const write = (level, message, extra = {}) => {
    if (LEVELS[level] < threshold) return;
    process.stdout.write(
      JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...context, ...fields, ...extra }) + '\n',
    );
  };
  return {
    debug: (m, e) => write('debug', m, e),
    info: (m, e) => write('info', m, e),
    warn: (m, e) => write('warn', m, e),
    error: (m, e) => write('error', m, e),
  };
}

export { context };
