// Local run without AWS: node scripts/invoke.js events/health.json
import { readFile } from 'node:fs/promises';
import { handler } from '../src/handler.js';

const event = JSON.parse(await readFile(process.argv[2] ?? 'events/health.json', 'utf8'));
const res = await handler(event, { awsRequestId: 'local' });
console.log(JSON.stringify(res, null, 2));
