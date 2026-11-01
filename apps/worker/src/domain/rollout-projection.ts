/**
 * Rollout projection. The PIPELINE orchestrates rollouts (rollout-waves.yml decides when a wave
 * starts and whether it halts — ADR-014); the app only mirrors what the pipeline reports and
 * offers one targeted action: retry the failed targets of a halted wave.
 *
 * Pure functions: (current projection, pipeline event) -> new projection (+ follow-up actions).
 */
import { WAVE_ORDER, type PipelineEvent, type Rollout, type WaveName } from '@northstar/shared';

type Started = Extract<PipelineEvent, { type: 'rollout.started' }>;

export function fromStarted(ev: Started, now = new Date()): Rollout {
  return {
    id: ev.rolloutId,
    change: ev.change,
    status: 'running',
    createdAt: now.toISOString(),
    waves: [...ev.waves]
      .sort((a, b) => WAVE_ORDER.indexOf(a.name) - WAVE_ORDER.indexOf(b.name))
      .map((w) => ({
        name: w.name,
        failureThreshold: w.failureThreshold,
        status: 'pending' as const,
        targets: w.targets.map((t) => ({ targetId: t.targetId, name: t.name, status: 'pending' as const, attempts: 0 })),
      })),
  };
}

export interface ResultStep {
  rollout: Rollout;
  /** Set when retries turned a halted wave fully green: dispatch rollout-waves.yml to resume after it. */
  resumeAfter?: WaveName;
}

/** One apply result from the pipeline (a wave run or an apply-baseline retry). */
export function recordResult(input: Rollout, targetId: string, status: 'succeeded' | 'failed', error?: string): ResultStep {
  const rollout = structuredClone(input);
  const wave = rollout.waves.find((w) => w.targets.some((t) => t.targetId === targetId));
  const target = wave?.targets.find((t) => t.targetId === targetId);
  if (!wave || !target) return { rollout };

  target.status = status;
  target.attempts += 1;
  if (status === 'failed') target.error = error ?? 'apply failed';
  else delete target.error;
  if (wave.status === 'pending') wave.status = 'running';

  // A retried halted wave that is now fully green: the operator's retry asked to continue.
  if (wave.status === 'halted' && wave.targets.every((t) => t.status === 'succeeded')) {
    wave.status = 'succeeded';
    const last = wave === rollout.waves[rollout.waves.length - 1];
    rollout.status = last ? 'succeeded' : 'running';
    return last ? { rollout } : { rollout, resumeAfter: wave.name };
  }
  return { rollout };
}

/** The pipeline's verdict on a wave (its gate job applied the failure threshold). */
export function recordWaveCompleted(input: Rollout, waveName: WaveName, status: 'succeeded' | 'halted'): Rollout {
  const rollout = structuredClone(input);
  const wave = rollout.waves.find((w) => w.name === waveName);
  if (!wave) return rollout;
  wave.status = status;
  const last = wave === rollout.waves[rollout.waves.length - 1];
  rollout.status = status === 'halted' ? 'halted' : last ? 'succeeded' : 'running';
  return rollout;
}

/** Operator retry: the failed targets of the halted wave, to dispatch apply-baseline.yml for. */
export function startRetry(input: Rollout): { rollout: Rollout; retry: Array<{ targetId: string; name: string }> } {
  const rollout = structuredClone(input);
  const wave = rollout.waves.find((w) => w.status === 'halted');
  if (!wave) return { rollout, retry: [] };
  const failed = wave.targets.filter((t) => t.status === 'failed');
  for (const t of failed) {
    t.status = 'running';
    delete t.error;
  }
  return { rollout, retry: failed.map((t) => ({ targetId: t.targetId, name: t.name })) };
}
