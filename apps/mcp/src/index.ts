/**
 * MCP server over the platform API. An assistant (Claude, Copilot, …) can ask "which Prod
 * accounts have drift, and who owns them?" — answered through the SAME public API with the SAME
 * role checks as the dashboard. The server holds no database credentials and no AWS access.
 *
 * Auth: NORTHSTAR_TOKEN (a bearer token for the user), or in the PoC NORTHSTAR_DEV_PERSON to use
 * the simulated Entra login. Production: an on-behalf-of token for the signed-in user.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { Exception, Finding, TargetDetail, TargetSummary } from '@northstar/shared';

const API_URL = process.env.NORTHSTAR_API_URL ?? 'http://localhost:3000';
let token = process.env.NORTHSTAR_TOKEN;

async function bearer(): Promise<string> {
  if (token) return token;
  const person = process.env.NORTHSTAR_DEV_PERSON ?? 'priya';
  const res = await fetch(`${API_URL}/v1/auth/dev-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ personId: person }),
  });
  if (!res.ok) throw new Error(`simulated sign-in failed: ${res.status}`);
  token = ((await res.json()) as { token: string }).token;
  return token;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { headers: { authorization: `Bearer ${await bearer()}` } });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
const env = z.enum(['sandbox', 'dev', 'test', 'prod', 'core']);

const server = new McpServer({ name: 'northstar-platform', version: '1.0.0' });

server.registerTool(
  'list_noncompliant_targets',
  {
    description:
      'AWS accounts that are not compliant (an open high/critical finding without exception), with owner, team and the open findings that cause it. Optionally filter by environment.',
    inputSchema: { env: env.optional().describe('sandbox | dev | test | prod | core') },
  },
  async ({ env: environment }) => {
    const qs = environment ? `?environment=${environment}` : '';
    const [targets, findings] = await Promise.all([
      get<TargetSummary[]>(`/v1/targets${qs}`),
      get<Finding[]>(`/v1/findings${qs ? `${qs}&` : '?'}status=open`),
    ]);
    return json(
      targets
        .filter((t) => !t.compliant)
        .map((t) => ({
          id: t.id,
          name: t.name,
          environment: t.environment,
          team: t.team,
          owner: t.owner,
          openFindings: findings
            .filter((f) => f.targetId === t.id)
            .map((f) => ({ source: f.source, rule: f.rule, severity: f.severity, resource: f.resource })),
        })),
    );
  },
);

server.registerTool(
  'get_target',
  {
    description: 'Detail of one AWS account by id or name: versions, findings by source, exceptions, recent deploys.',
    inputSchema: { id: z.string().describe('12-digit account id or account name, e.g. payments-prod') },
  },
  async ({ id }) => json(await get<TargetDetail>(`/v1/targets/${encodeURIComponent(id)}`)),
);

server.registerTool(
  'list_expiring_exceptions',
  {
    description: 'Governance exceptions expiring within N days (default 14), including already expired ones.',
    inputSchema: { days: z.number().int().min(0).max(365).optional() },
  },
  async ({ days = 14 }) => {
    const cutoff = Date.now() + days * 86_400_000;
    const list = await get<Exception[]>('/v1/exceptions');
    return json(list.filter((e) => new Date(e.expiresAt).getTime() <= cutoff));
  },
);

await server.connect(new StdioServerTransport());
