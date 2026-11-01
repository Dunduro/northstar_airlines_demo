import { describe, expect, it } from 'vitest';
import { buildOverview } from '../src/read-models.js';

const target = (i: number) => ({ id: `1000000000${10 + i}`, name: `acct-${i}`, environment: i < 5 ? 'prod' : 'dev', team: 'cargo', owner: 'o', ou: 'x', flavours: [], baseline_version: '2.3.0', module_versions: {} });
const finding = (i: number, status: string, severity = 'high') => ({
  id: `f-${i}-${status}`, target_id: target(i).id, source: 'config', rule: `R${i}`, severity, resource: 'r', status,
  first_seen: '2026-11-01T00:00:00Z', last_seen: `2026-11-01T00:00:${String(i).padStart(2, '0')}Z`, link: '',
});

function db(targets: any[], findings: any[]) {
  return {
    query: async (sql: string) => {
      if (sql.includes('FROM targets')) return { rows: targets };
      if (sql.includes('FROM findings')) return { rows: findings };
      if (sql.includes('compliance_snapshots')) return { rows: [{ day: '2026-10-31', ratio: 0.5 }] };
      return { rows: [] };
    },
  } as any;
}

describe('overview read model', () => {
  it('counts ALL open high/critical findings, not just the 8-item shortlist; waived ones do not count', async () => {
    const targets = Array.from({ length: 12 }, (_, i) => target(i));
    const findings = [...Array.from({ length: 10 }, (_, i) => finding(i, 'open')), finding(10, 'waived'), finding(11, 'open', 'low')];
    const o = await buildOverview(db(targets, findings));
    expect(o.critical).toHaveLength(8);
    expect(o.openHighOrCritical).toBe(10);
    expect(o.totalTargets).toBe(12);
    expect(o.percentCompliant).toBe(16.7); // 2 of 12: the waived one and the low one
    expect(o.heatmap.find((c) => c.environment === 'prod')).toMatchObject({ total: 5, compliant: 0 });
    expect(o.trend.map((t) => t.percentCompliant)).toEqual([50, 16.7]); // history + today's live value last
  });
});
