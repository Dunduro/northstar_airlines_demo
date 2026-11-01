/**
 * Alert routing: event -> owner -> channel, with dedupe and grouping.
 *
 *  - Every alert has an owner (a team channel), never "someone should look at this".
 *  - Dedupe: the same alert key is not re-sent inside the dedupe window.
 *  - Grouping: when one cause hits many accounts (one bad guardrail change), we send ONE alert
 *    to platform on-call instead of paging every team.
 */
import { SEVERITY_RANK, type Environment, type FindingSource, type Severity } from '@northstar/shared';

export interface AlertCandidate {
  /** Dedupe key, e.g. "finding:<targetId>:<source>:<rule>:<resource>". */
  key: string;
  kind: 'finding' | 'rollout-halted' | 'dead-letter';
  source?: FindingSource;
  rule: string;
  severity: Severity;
  team: string;
  environment?: Environment;
  targetId?: string;
  targetName?: string;
  resource?: string;
  /** What caused it (run URL, change ref). Candidates sharing rule + resource + cause are one problem. */
  cause?: string;
  title: string;
  link: string;
}

export interface Route {
  severity: Severity;
  delivery: 'now' | 'digest';
  channels: string[];
  ticket: boolean;
}

export interface Delivery extends Route {
  key: string;
  team: string;
  title: string;
  link: string;
  members: AlertCandidate[];
}

export const PLATFORM_ONCALL = 'platform-oncall';
export const GROUP_MIN_TARGETS = 3;

/** The routing table from the architecture (section 5.7). */
export function route(c: AlertCandidate): Route {
  const team = `teams:${c.team}`;
  if (c.kind === 'rollout-halted' || c.kind === 'dead-letter')
    return { severity: 'high', delivery: 'now', channels: [`teams:${PLATFORM_ONCALL}`], ticket: false };
  if (c.source === 'drift') {
    return c.environment === 'prod' || c.environment === 'core'
      ? { severity: 'high', delivery: 'now', channels: [team], ticket: true }
      : { severity: 'low', delivery: 'digest', channels: [team], ticket: false };
  }
  if (c.severity === 'critical') return { severity: 'critical', delivery: 'now', channels: [team, 'teams:security'], ticket: true };
  if (c.rule === 'exception-expired') return { severity: 'high', delivery: 'now', channels: [team, `teams:${c.team}-leads`], ticket: false };
  if (c.rule === 'exception-expiring') return { severity: 'medium', delivery: 'now', channels: [team], ticket: false };
  if (c.severity === 'high') return { severity: 'high', delivery: 'now', channels: [team], ticket: false };
  return { severity: c.severity, delivery: 'digest', channels: [team], ticket: false };
}

/** Same rule, same resource, same cause (run / change) across accounts = one problem. */
const groupKey = (c: AlertCandidate) => `${c.rule}|${c.resource ?? ''}|${c.cause ?? ''}`;

/**
 * Turn a batch of candidates into deliveries.
 * @param recentlySent keys already alerted inside the dedupe window (from the alerts table)
 */
export function planAlerts(
  candidates: AlertCandidate[],
  recentlySent: Set<string>,
  groupMin = GROUP_MIN_TARGETS,
): { deliveries: Delivery[]; suppressed: AlertCandidate[] } {
  const suppressed: AlertCandidate[] = [];
  const fresh: AlertCandidate[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (recentlySent.has(c.key) || seen.has(c.key)) suppressed.push(c);
    else {
      seen.add(c.key);
      fresh.push(c);
    }
  }

  const groups = new Map<string, AlertCandidate[]>();
  for (const c of fresh) {
    const k = c.kind === 'finding' ? groupKey(c) : `single|${c.key}`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }

  const deliveries: Delivery[] = [];
  for (const [k, members] of groups) {
    const targets = new Set(members.map((m) => m.targetId));
    if (members[0]!.kind === 'finding' && targets.size >= groupMin) {
      const routes = members.map(route);
      const severity = routes.map((r) => r.severity).sort((a, b) => SEVERITY_RANK[b] - SEVERITY_RANK[a])[0]!;
      deliveries.push({
        key: `group:${k}`,
        team: PLATFORM_ONCALL,
        severity,
        delivery: routes.some((r) => r.delivery === 'now') ? 'now' : 'digest',
        channels: [`teams:${PLATFORM_ONCALL}`],
        ticket: routes.some((r) => r.ticket),
        title: `${members[0]!.rule} on ${members[0]!.resource}: ${targets.size} accounts, one cause — grouped to platform on-call instead of paging ${new Set(members.map((m) => m.team)).size} teams`,
        link: members[0]!.cause ?? members[0]!.link,
        members,
      });
    } else {
      for (const c of members) deliveries.push({ ...route(c), key: c.key, team: c.team, title: c.title, link: c.link, members: [c] });
    }
  }
  return { deliveries, suppressed };
}
