import PgBoss from 'pg-boss';
import { createPool, migrate } from '@northstar/db';
import { ensureQueues } from '@northstar/shared/queue';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const db = createPool(config.databaseUrl);
await migrate(db);

// The API only produces jobs: no polling, no maintenance, no cron here (the worker does that).
const boss = new PgBoss({ connectionString: config.databaseUrl, supervise: false, schedule: false });
boss.on('error', (err) => console.error('[pg-boss]', err));
await boss.start();
await ensureQueues(boss);

const app = await buildApp({ config, db, boss });
await app.listen({ port: config.port, host: '0.0.0.0' });

const shutdown = async () => {
  await app.close();
  await boss.stop({ graceful: false });
  await db.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
