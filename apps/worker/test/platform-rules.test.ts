import { describe, expect, it } from 'vitest';
import { CATALOG, type Exception, type Target } from '@northstar/shared';
import { runPlatformRules, waiverStatus } from '../src/domain/platform-rules.js';

const now = new Date('2026-11-01T08:00:00Z');
const target = (over: Partial<Target> = {}): Target => ({
  id: '100000000101',
  name: 'payments-dev',
  cloud: 'aws',
  environment: 'dev',
  team: 'payments',
  owner: 'payments-lead@northstar.example',
  ou: 'Workloads/Dev',
  flavours: ['ecs-service'],
  baselineVersion: '2.4.0',
  moduleVersions: { 'ecs-service': '2.3.0' },
  ...over,
});
const exception = (days: number, rule = 'CKV_AWS_18'): Exception => ({
  id: 'e1',
  targetId: '100000000101',
  rule,
  owner: 'lead@northstar.example',
  reason: 'r',
  compensatingControl: 'c',
  expiresAt: new Date(now.getTime() + days * 86_400_000).toISOString(),
});
const rulesOf = (t: Target, ex: Exception[] = []) => runPlatformRules(t, ex, now).map((f) => `${f.rule}:${f.severity}`);

describe('platform rules', () => {
  it('a current, owned account on supported versions has no findings', () => {
    expect(runPlatformRules(target(), [], now)).toEqual([]);
  });

  it('flags a baseline below the minimum supported version as high', () => {
    expect(rulesOf(target({ baselineVersion: '1.9.0' }))).toEqual(['baseline-version-supported:high']);
  });

  it('flags a baseline two or more minors behind as low (who is behind, by how much)', () => {
    expect(rulesOf(target({ baselineVersion: '2.1.0' }))).toEqual(['baseline-version-behind:low']);
    expect(rulesOf(target({ baselineVersion: '2.3.0' }))).toEqual([]);
  });

  it('supports golden-path majors N and N-1 only', () => {
    expect(rulesOf(target({ moduleVersions: { 'ecs-service': '1.8.0' } }))).toEqual([]);
    expect(rulesOf(target({ moduleVersions: { 'ecs-service': '0.9.2' } }))).toEqual(['module-version-supported:high']);
  });

  it('flags a deprecated golden path with its replacement', () => {
    // No golden path is deprecated in the current catalog; deprecate one for the test.
    const catalog = {
      ...CATALOG,
      goldenPaths: { ...CATALOG.goldenPaths, 'beanstalk-app': { latest: '3.1.0', supportedMajors: [3], deprecated: true, replacement: 'ecs-service' } },
    };
    const [f] = runPlatformRules(target({ flavours: ['beanstalk-app'], moduleVersions: {} }), [], now, catalog);
    expect(f).toMatchObject({ rule: 'golden-path-not-deprecated', severity: 'medium', resource: 'beanstalk-app -> ecs-service' });
  });

  it('the paved-road golden paths in the catalog are not deprecated', () => {
    expect(runPlatformRules(target({ flavours: ['ecs-service', 'lambda-api', 'static-site'], moduleVersions: {} }), [], now)).toEqual([]);
  });

  it('flags ownerless accounts', () => {
    expect(rulesOf(target({ owner: '' }))).toEqual(['owner-and-team-set:high']);
    expect(rulesOf(target({ team: 'unknown' }))).toEqual(['owner-and-team-set:high']);
  });

  it('warns 14 days before an exception expires, and flags expired ones as high', () => {
    expect(rulesOf(target(), [exception(30)])).toEqual([]);
    expect(rulesOf(target(), [exception(9)])).toEqual(['exception-expiring:medium']);
    expect(rulesOf(target(), [exception(-1)])).toEqual(['exception-expired:high']);
  });

  it('only an unexpired exception for the same target and rule waives a finding', () => {
    const finding = { targetId: '100000000101', rule: 'CKV_AWS_18', status: 'open' as const };
    expect(waiverStatus(finding, [exception(5)], now)).toBe('waived');
    expect(waiverStatus(finding, [exception(-1)], now)).toBe('open'); // expired: re-opens
    expect(waiverStatus(finding, [exception(5, 'other-rule')], now)).toBe('open');
    expect(waiverStatus({ ...finding, status: 'resolved' }, [exception(5)], now)).toBe('resolved');
  });
});
