/** Writes apps/api/openapi.json from the route schemas (CI diffs it to catch contract changes). */
import { writeFileSync } from 'node:fs';
import { buildApp } from '../src/app.js';

process.env.NODE_ENV = 'test'; // quiet logger (read when buildApp runs)

const unused = () => {
  throw new Error('not used while generating OpenAPI');
};
const app = await buildApp({
  config: { port: 0, databaseUrl: '', jwtSecret: 'openapi', webhookSecret: 'openapi', simulatedAuth: true, demoMode: false },
  db: { query: unused, connect: unused } as any,
  boss: { send: unused, getQueueSize: unused } as any,
});
await app.ready();
const out = new URL('../openapi.json', import.meta.url);
writeFileSync(out, JSON.stringify(app.swagger(), null, 2) + '\n');
console.log(`wrote ${out.pathname}`);
await app.close();
