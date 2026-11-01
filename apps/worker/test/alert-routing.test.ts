import { describe, expect, it } from 'vitest';
import { planAlerts, route, type AlertCandidate } from '../src/domain/alert-routing.js';

const drift = (team: string, environment: AlertCandidate['environment'], over: Partial<AlertCandidate> = {}): AlertCandidate => ({
  key: `finding:${team}-${environment}:drift:terraform-drift:aws_security_group.alb`,
  kind: 'finding',
  source: 'drift',
  rule: 'terraform-drift',
  severity: environment === 'prod' ? 'high' : 'low',
  team,
  environment,
  targetId: `${team}-${environment}`,
  targetName: `${team}-${environment}`,
  resource: 'aws_security_group.alb',
  cause: 'run/1',
  title: 't',
  link: 'l',
  ...over,
});

describe('alert routing', () => {
  it('Prod drift pages the owning team with a ticket; Dev drift goes to the daily digest', () => {
    expect(route(drift('payments', 'prod'))).toEqual({ severity: 'high', delivery: 'now', channels: ['teams:payments'], ticket: true });
    expect(route(drift('payments', 'dev'))).toEqual({ severity: 'low', delivery: 'digest', channels: ['teams:payments'], ticket: false });
  });

  it('critical findings go to the team AND security, with a ticket', () => {
    const r = route({ ...drift('crew', 'dev'), source: 'config', severity: 'critical', rule: 'S3.2' });
    expect(r).toMatchObject({ severity: 'critical', delivery: 'now', ticket: true, channels: ['teams:crew', 'teams:security'] });
  });

  it('a halted rollout wave goes to platform on-call', () => {
    const r = route({ ...drift('platform', undefined), kind: 'rollout-halted', source: undefined, rule: 'rollout-wave-failed', severity: 'high' });
    expect(r.channels).toEqual(['teams:platform-oncall']);
  });

  it('dedupes: a key already sent in the window is suppressed, and duplicates in one batch collapse', () => {
    const a = drift('payments', 'prod');
    const { deliveries, suppressed } = planAlerts([a, a], new Set());
    expect(deliveries).toHaveLength(1);
    expect(suppressed).toHaveLength(1);

    const again = planAlerts([a], new Set([a.key]));
    expect(again.deliveries).toHaveLength(0);
    expect(again.suppressed).toEqual([a]);
  });

  it('groups one cause across many accounts into ONE platform alert instead of paging every team', () => {
    const teams = ['payments', 'cargo', 'crew', 'loyalty'];
    const candidates = teams.map((t) =>
      drift(t, 'prod', { key: `k-${t}`, resource: 'module.baseline.aws_iam_role.deploy', cause: 'guardrail-pr-142' }),
    );
    const { deliveries } = planAlerts(candidates, new Set());
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ team: 'platform-oncall', channels: ['teams:platform-oncall'], severity: 'high', ticket: true });
    expect(deliveries[0]!.members).toHaveLength(4);
  });

  it('does not group unrelated findings (different cause) or fewer than 3 accounts', () => {
    const two = planAlerts([drift('payments', 'prod', { key: 'a' }), drift('cargo', 'prod', { key: 'b', targetId: 'x' })], new Set());
    expect(two.deliveries.map((d) => d.team)).toEqual(['payments', 'cargo']);
    const unrelated = planAlerts(
      ['payments', 'cargo', 'crew'].map((t, i) => drift(t, 'prod', { key: t, cause: `run/${i}` })),
      new Set(),
    );
    expect(unrelated.deliveries).toHaveLength(3);
  });
});
