import { buildApp } from './app.js';

const app = buildApp();
const port = Number(process.env.PORT ?? 8080);

// ECS sends SIGTERM and waits stopTimeout (30 s): finish in-flight requests, then exit.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    process.exit(0);
  });
}

await app.listen({ host: '0.0.0.0', port });
