import { describe, expect, it } from 'vitest';
import { fromStarted, recordResult, recordWaveCompleted, startRetry } from '../src/domain/rollout-projection.js';

const t = (name: string) => ({ targetId: name, name });
const started = fromStarted({
  type: 'rollout.started',
  rolloutId: 'ro-1',
  change: { ref: 'abc', title: 'Guardrail: region-lock' },
  waves: [
    { name: 'prod', failureThreshold: 0, targets: [t('payments-prod')] },
    { name: 'sandbox', failureThreshold: 0.02, targets: [t('payments-sandbox')] },
    { name: 'test', failureThreshold: 0.02, targets: [t('payments-test'), t('cargo-test')] },
  ],
});

/** The pipeline's story up to a halted Test wave. */
function haltedInTest() {
  let r = recordResult(started, 'payments-sandbox', 'succeeded').rollout;
  r = recordWaveCompleted(r, 'sandbox', 'succeeded');
  r = recordResult(r, 'payments-test', 'succeeded').rollout;
  r = recordResult(r, 'cargo-test', 'failed', 'AccessDenied').rollout;
  return recordWaveCompleted(r, 'test', 'halted');
}

describe('rollout projection (the app mirrors the pipeline)', () => {
  it('orders waves and starts everything pending', () => {
    expect(started.waves.map((w) => w.name)).toEqual(['sandbox', 'test', 'prod']);
    expect(started.waves.every((w) => w.status === 'pending')).toBe(true);
  });

  it('marks a wave running on its first result and records errors', () => {
    const r = recordResult(started, 'cargo-test', 'failed', 'boom').rollout;
    expect(r.waves[1]).toMatchObject({ status: 'running' });
    expect(r.waves[1]!.targets[1]).toMatchObject({ status: 'failed', error: 'boom', attempts: 1 });
  });

  it("mirrors the pipeline's halt verdict; it never decides one itself", () => {
    const r = haltedInTest();
    expect(r.status).toBe('halted');
    expect(r.waves.map((w) => w.status)).toEqual(['succeeded', 'halted', 'pending']);
    // results alone never halt or advance anything
    const onlyResults = recordResult(started, 'cargo-test', 'failed').rollout;
    expect(onlyResults.status).toBe('running');
  });

  it('retry selects only the failed targets of the halted wave', () => {
    const { rollout, retry } = startRetry(haltedInTest());
    expect(retry).toEqual([t('cargo-test')]);
    expect(rollout.waves[1]!.targets.find((x) => x.name === 'cargo-test')!.status).toBe('running');
    expect(startRetry(started).retry).toEqual([]);
  });

  it('when retries make the halted wave green, asks the pipeline to resume after it', () => {
    const { rollout } = startRetry(haltedInTest());
    const step = recordResult(rollout, 'cargo-test', 'succeeded');
    expect(step.resumeAfter).toBe('test');
    expect(step.rollout.status).toBe('running');
    expect(step.rollout.waves[1]!.status).toBe('succeeded');
    expect(step.rollout.waves[2]!.status).toBe('pending'); // prod runs only when the pipeline says so
  });

  it('the last wave succeeding completes the rollout', () => {
    let r = recordWaveCompleted(haltedInTest(), 'test', 'succeeded');
    r = recordWaveCompleted(r, 'prod', 'succeeded');
    expect(r.status).toBe('succeeded');
  });
});
