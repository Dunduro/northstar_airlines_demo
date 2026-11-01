/**
 * Outbound integrations. The worker only ever talks to Teams, the ITSM tool and GitHub's
 * workflow_dispatch — it has NO credentials for AWS. Every change goes through the pipeline.
 */
import { config } from './config.js';

async function post(url: string, body: unknown): Promise<Response> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`POST ${url} -> ${res.status}`); // throw = pg-boss retries with backoff
  return res;
}

export interface TeamsMessage {
  title: string;
  severity: string;
  text: string;
  link: string;
}

export const sendTeams = (channel: string, msg: TeamsMessage) =>
  post(`${config.teamsWebhookBase}/${encodeURIComponent(channel)}`, msg);

export async function openTicket(input: { title: string; team: string; severity: string; link: string }): Promise<string> {
  const res = await post(`${config.serviceNowUrl}/api/now/table/incident`, {
    short_description: input.title,
    assignment_group: input.team,
    urgency: input.severity === 'critical' ? 1 : 2,
    description: input.link,
  });
  const body = (await res.json()) as { result?: { number?: string } };
  return body.result?.number ?? 'unknown';
}

/** GitHub REST: POST /repos/{owner}/{repo}/actions/workflows/{workflow}/dispatches */
export const dispatchWorkflow = (workflow: string, ref: string, inputs: Record<string, string>) =>
  post(`${config.githubApiUrl}/repos/${config.githubRepo}/actions/workflows/${workflow}/dispatches`, { ref, inputs });
