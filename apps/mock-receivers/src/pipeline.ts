/**
 * What rollout-waves.yml / apply-wave.yml decide, reproduced for the PoC simulation. In the real
 * system this logic lives in the workflows (the gate job's jq); the platform app only mirrors it.
 */
export const WAVES = ['sandbox', 'dev', 'test', 'prod'] as const;
export type WaveName = (typeof WAVES)[number];

export interface RegistryAccount {
  id: string;
  name: string;
  environment: string;
  ou: string;
}

export interface PlannedWave {
  name: WaveName;
  failureThreshold: number;
  targets: Array<{ targetId: string; name: string }>;
}

/** Same thresholds as rollout-waves.yml: 2 % per wave, any failure in prod. */
export const thresholdFor = (wave: WaveName) => (wave === 'prod' ? 0 : 0.02);

/** Same selection as .github/scripts/wave-accounts.sh: core accounts ride in the prod wave; Suspended never. */
export function planWaves(accounts: RegistryAccount[]): PlannedWave[] {
  const waveOf = (a: RegistryAccount) => (a.environment === 'core' ? 'prod' : a.environment);
  return WAVES.map((name) => ({
    name,
    failureThreshold: thresholdFor(name),
    targets: accounts
      .filter((a) => a.ou !== 'Suspended' && waveOf(a) === name)
      .map((a) => ({ targetId: a.id, name: a.name })),
  })).filter((w) => w.targets.length > 0);
}

/** The gate: halt when failed/total exceeds the threshold. A missing result counts as a failure. */
export function waveHalts(failed: number, total: number, threshold: number): boolean {
  return total > 0 && failed / total > threshold;
}

/** Waves still to run; on resume, everything up to and including `resumeAfter` is skipped. */
export function wavesToRun(plan: PlannedWave[], resumeAfter?: string): PlannedWave[] {
  if (!resumeAfter) return plan;
  const from = WAVES.indexOf(resumeAfter as WaveName);
  return plan.filter((w) => WAVES.indexOf(w.name) > from);
}
