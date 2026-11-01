/** Small HTTP client: signed webhooks (like the pipeline / HR), user calls (like the UI). */
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { SIGNATURE_HEADER, sign } from '@northstar/shared/hmac';
import type { RegistryAccount } from '@northstar/shared';

export const API_URL = process.env.API_URL ?? 'http://localhost:3000';
export const MOCK_URL = process.env.MOCK_URL ?? 'http://localhost:4000';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? 'local-dev-only-webhook-secret';
export const DASHBOARD_URL = process.env.DASHBOARD_URL ?? 'http://localhost:5173';

const REGISTRY = process.env.REGISTRY_PATH ?? new URL('../../terraform/registry/accounts.yaml', import.meta.url).pathname;

export function loadRegistry(): RegistryAccount[] {
  const doc = parse(readFileSync(REGISTRY, 'utf8')) as { accounts: RegistryAccount[] };
  return doc.accounts.map((a) => ({ ...a, id: String(a.id), flavours: a.flavours ?? [] }));
}

export function account(nameOrId: string): RegistryAccount {
  const a = loadRegistry().find((x) => x.name === nameOrId || x.id === nameOrId);
  if (!a) throw new Error(`Unknown account "${nameOrId}" (not in the registry)`);
  return a;
}

async function check(res: Response, what: string) {
  if (!res.ok) throw new Error(`${what} -> ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : undefined;
}

/** POST signed with the shared HMAC secret, exactly like GitHub Actions / the HR system would. */
export async function signed(path: string, body: unknown = {}) {
  const raw = JSON.stringify(body);
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: sign(raw, WEBHOOK_SECRET) },
    body: raw,
  });
  return check(res, `POST ${path}`);
}

export const pipeline = (event: object) => signed('/v1/events/pipeline', event);
export const membership = (event: object) => signed('/v1/events/membership', event);

/** Simulated Entra sign-in as a person; returns a bearer token. */
export async function login(personId: string): Promise<string> {
  const res = await fetch(`${API_URL}/v1/auth/dev-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ personId }),
  });
  return (await check(res, `login ${personId}`)).token;
}

export async function asUser(token: string, method: 'GET' | 'POST', path: string, body?: unknown) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return check(res, `${method} ${path}`);
}

export async function mock(path: string, body: unknown = {}) {
  const res = await fetch(`${MOCK_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return check(res, `mock ${path}`);
}

/** Wait until the worker has drained the queue (the API is async: 202 now, work later). */
export async function waitIdle(timeoutMs = 30_000) {
  const start = Date.now();
  let idleChecks = 0;
  while (Date.now() - start < timeoutMs) {
    const { pending } = await check(await fetch(`${API_URL}/v1/demo/queue`), 'queue');
    idleChecks = pending === 0 ? idleChecks + 1 : 0;
    if (idleChecks >= 2) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('worker did not drain the queue in time — is the worker running?');
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const slug = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
export const runUrl = () => `https://github.com/northstar/landing-zone/actions/runs/${Math.floor(6_000_000 + Math.random() * 900_000)}`;
