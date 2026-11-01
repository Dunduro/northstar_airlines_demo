/** Job names and payloads — the contract between the API (producer) and the worker (consumer). */
export const JOBS = {
  evaluateTarget: 'evaluate-target',
  runPlatformRules: 'run-platform-rules',
  routeAlert: 'route-alert',
  dispatchWorkflow: 'dispatch-workflow',
  projectRollout: 'project-rollout',
  onboardingStep: 'onboarding-step',
  sendDigest: 'send-digest',
  snapshotCompliance: 'snapshot-compliance',
  deadLetter: 'dead-letter',
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];

/** Most jobs only carry the id of the event that caused them: the event log is the source of truth. */
export interface EventJob {
  eventId: string;
}

export interface DispatchWorkflowJob {
  workflow: string;
  ref: string;
  inputs: Record<string, string>;
}

export interface PlatformRulesJob {
  targetId?: string; // omitted = whole estate (nightly)
}
