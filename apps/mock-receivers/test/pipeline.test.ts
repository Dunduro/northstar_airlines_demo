import { describe, expect, it } from 'vitest';
import { planWaves, waveHalts, wavesToRun, type RegistryAccount } from '../src/pipeline.js';

const acc = (name: string, environment: string, ou = 'Workloads'): RegistryAccount => ({ id: name, name, environment, ou });
const registry = [
  ...['payments', 'cargo', 'crew', 'loyalty'].flatMap((team) => ['sandbox', 'dev', 'test', 'prod'].map((env) => acc(`${team}-${env}`, env))),
  acc('security-audit', 'core', 'Security'),
  acc('old-thing', 'dev', 'Suspended'),
];

describe('wave plan (as rollout-waves.yml computes it)', () => {
  it('orders sandbox -> dev -> test -> prod, core in prod, never Suspended', () => {
    const plan = planWaves(registry);
    expect(plan.map((w) => w.name)).toEqual(['sandbox', 'dev', 'test', 'prod']);
    expect(plan[3]!.targets.map((t) => t.name)).toContain('security-audit');
    expect(plan.flatMap((w) => w.targets).map((t) => t.name)).not.toContain('old-thing');
    expect(plan.map((w) => w.failureThreshold)).toEqual([0.02, 0.02, 0.02, 0]);
  });

  it('resuming after a wave runs only the later waves', () => {
    expect(wavesToRun(planWaves(registry), 'test').map((w) => w.name)).toEqual(['prod']);
    expect(wavesToRun(planWaves(registry)).length).toBe(4);
  });
});

describe('wave gate (failure threshold)', () => {
  it('halts a 4-account Test wave on one failure (25 % > 2 %)', () => {
    expect(waveHalts(1, 4, 0.02)).toBe(true);
  });

  it('tolerates failures at or under the threshold outside prod: partial failure is normal', () => {
    expect(waveHalts(2, 100, 0.02)).toBe(false);
    expect(waveHalts(3, 100, 0.02)).toBe(true);
  });

  it('any prod failure halts', () => {
    expect(waveHalts(1, 400, 0)).toBe(true);
    expect(waveHalts(0, 8, 0)).toBe(false);
  });
});
