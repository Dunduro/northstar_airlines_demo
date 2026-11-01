/**
 * The domain model, defined once. TypeBox gives us both the TypeScript type (Static<>) and the
 * JSON Schema Fastify validates against and publishes as OpenAPI.
 */
import { Type, type Static, type TSchema } from '@sinclair/typebox';

const StringEnum = <T extends string[]>(values: [...T], description?: string) =>
  Type.Unsafe<T[number]>({ type: 'string', enum: values, description });

export const ENVIRONMENTS = ['sandbox', 'dev', 'test', 'prod', 'core'] as const;
export const WAVE_ORDER = ['sandbox', 'dev', 'test', 'prod'] as const;
export const TEAMS = ['payments', 'cargo', 'crew', 'loyalty', 'platform', 'security'] as const;

export const Environment = StringEnum([...ENVIRONMENTS]);
export type Environment = Static<typeof Environment>;
export const WaveName = StringEnum([...WAVE_ORDER]);
export type WaveName = Static<typeof WaveName>;
export const Severity = StringEnum(['low', 'medium', 'high', 'critical']);
export type Severity = Static<typeof Severity>;
export const FindingSource = StringEnum(['drift', 'policy', 'config', 'platform']);
export type FindingSource = Static<typeof FindingSource>;
export const FindingStatus = StringEnum(['open', 'resolved', 'waived']);
export type FindingStatus = Static<typeof FindingStatus>;
export const Role = StringEnum(['viewer', 'operator', 'admin'], 'App role, from Entra group claims');
export type Role = Static<typeof Role>;

// ---------- Target (an AWS account) ----------
export const Target = Type.Object({
  id: Type.String({ pattern: '^[0-9]{12}$' }),
  name: Type.String(),
  cloud: Type.Literal('aws'),
  environment: Environment,
  team: Type.String(),
  owner: Type.String(),
  ou: Type.String(),
  flavours: Type.Array(Type.String()),
  baselineVersion: Type.String(),
  moduleVersions: Type.Record(Type.String(), Type.String()),
});
export type Target = Static<typeof Target>;

export const TargetSummary = Type.Composite([
  Target,
  Type.Object({
    compliant: Type.Boolean(),
    openFindings: Type.Integer(),
    highestSeverity: Type.Union([Severity, Type.Null()]),
  }),
]);
export type TargetSummary = Static<typeof TargetSummary>;

// ---------- Finding ----------
export const Finding = Type.Object({
  id: Type.String(),
  targetId: Type.String(),
  source: FindingSource,
  rule: Type.String(),
  severity: Severity,
  resource: Type.String(),
  status: FindingStatus,
  firstSeen: Type.String({ format: 'date-time' }),
  lastSeen: Type.String({ format: 'date-time' }),
  link: Type.String({ description: 'Link to the original (plan run, Config rule, …)' }),
});
export type Finding = Static<typeof Finding>;

// ---------- Exception ----------
export const Exception = Type.Object({
  id: Type.String(),
  targetId: Type.String(),
  rule: Type.String(),
  owner: Type.String(),
  reason: Type.String(),
  compensatingControl: Type.String(),
  expiresAt: Type.String({ format: 'date-time' }),
});
export type Exception = Static<typeof Exception>;
export const NewException = Type.Omit(Exception, ['id']);
export type NewException = Static<typeof NewException>;

// ---------- Rollout ----------
export const WaveTarget = Type.Object({
  targetId: Type.String(),
  name: Type.String(),
  status: StringEnum(['pending', 'running', 'succeeded', 'failed']),
  error: Type.Optional(Type.String()),
  attempts: Type.Integer(),
});
export type WaveTarget = Static<typeof WaveTarget>;

export const Wave = Type.Object({
  name: WaveName,
  targets: Type.Array(WaveTarget),
  failureThreshold: Type.Number({ description: 'Fraction of targets allowed to fail, e.g. 0.02' }),
  status: StringEnum(['pending', 'running', 'succeeded', 'halted']),
});
export type Wave = Static<typeof Wave>;

export const Rollout = Type.Object({
  id: Type.String(),
  change: Type.Object({ ref: Type.String(), title: Type.String() }),
  waves: Type.Array(Wave),
  status: StringEnum(['pending', 'running', 'halted', 'succeeded']),
  createdAt: Type.String({ format: 'date-time' }),
});
export type Rollout = Static<typeof Rollout>;

// ---------- Event log ----------
export const EventRecord = Type.Object({
  id: Type.String(),
  type: Type.String(),
  source: Type.String(),
  payload: Type.Unknown(),
  receivedAt: Type.String({ format: 'date-time' }),
});
export type EventRecord = Static<typeof EventRecord>;

// ---------- Inbound pipeline events (POST /v1/events/pipeline) ----------
const RegistryAccount = Type.Object({
  id: Type.String({ pattern: '^[0-9]{12}$' }),
  name: Type.String(),
  environment: Environment,
  team: Type.String(),
  owner: Type.String(),
  ou: Type.String(),
  flavours: Type.Array(Type.String()),
  baseline_version: Type.String(),
});
export type RegistryAccount = Static<typeof RegistryAccount>;

const ExternalFinding = Type.Object({
  rule: Type.String(),
  severity: Severity,
  resource: Type.String(),
  link: Type.Optional(Type.String()),
});

export const PipelineEvent = Type.Union([
  Type.Object({
    type: Type.Literal('registry.sync'),
    ref: Type.String(),
    accounts: Type.Array(RegistryAccount),
  }),
  Type.Object({
    type: Type.Literal('plan.result'),
    accountId: Type.String(),
    runUrl: Type.String(),
    summary: Type.Object({ add: Type.Integer(), change: Type.Integer(), destroy: Type.Integer() }),
    policyFindings: Type.Array(ExternalFinding, { description: 'Checkov / OPA results on the plan' }),
  }),
  Type.Object({
    type: Type.Literal('apply.result'),
    accountId: Type.String(),
    runUrl: Type.String(),
    ref: Type.String(),
    status: StringEnum(['succeeded', 'failed']),
    error: Type.Optional(Type.String()),
    rolloutId: Type.Optional(Type.String()),
    baselineVersion: Type.Optional(Type.String()),
    moduleVersions: Type.Optional(Type.Record(Type.String(), Type.String())),
    /** baseline (default): the landing-zone baseline was applied. deploy: a team's app release. */
    scope: Type.Optional(StringEnum(['baseline', 'deploy'])),
  }),
  Type.Object({
    type: Type.Literal('drift.result'),
    runUrl: Type.String(),
    accounts: Type.Array(
      Type.Object({
        accountId: Type.String(),
        drifted: Type.Boolean(),
        resources: Type.Array(Type.String({ description: 'Terraform address, e.g. aws_s3_bucket.logs' })),
      }),
    ),
  }),
  Type.Object({
    type: Type.Literal('config.findings'),
    accountId: Type.String(),
    findings: Type.Array(ExternalFinding, { description: 'AWS Config / Security Hub, normalised' }),
  }),
  // Rollouts are orchestrated by the pipeline (rollout-waves.yml); the app mirrors them (ADR-014).
  Type.Object({
    type: Type.Literal('rollout.started'),
    rolloutId: Type.String(),
    change: Type.Object({ ref: Type.String(), title: Type.String() }),
    waves: Type.Array(
      Type.Object({
        name: WaveName,
        failureThreshold: Type.Number({ minimum: 0, maximum: 1 }),
        targets: Type.Array(Type.Object({ targetId: Type.String(), name: Type.String() })),
      }),
    ),
  }),
  Type.Object({
    type: Type.Literal('wave.completed'),
    rolloutId: Type.String(),
    wave: WaveName,
    status: StringEnum(['succeeded', 'halted']),
    failed: Type.Integer(),
    total: Type.Integer(),
  }),
]);
export type PipelineEvent = Static<typeof PipelineEvent>;

// ---------- Inbound membership events (POST /v1/events/membership) ----------
export const PersonRole = StringEnum(['developer', 'lead', 'platform-engineer', 'security']);
export type PersonRole = Static<typeof PersonRole>;

export const Person = Type.Object({
  id: Type.String(),
  name: Type.String(),
  email: Type.String(),
  team: Type.String(),
  role: PersonRole,
  status: StringEnum(['active', 'left']),
});
export type Person = Static<typeof Person>;

export const MembershipEvent = Type.Object({
  type: StringEnum(['joiner', 'mover', 'leaver']),
  person: Type.Object({
    id: Type.String({ pattern: '^[a-z0-9.-]+$' }),
    name: Type.Optional(Type.String()),
    email: Type.Optional(Type.String()),
    team: Type.Optional(Type.String()),
    role: Type.Optional(PersonRole),
  }),
});
export type MembershipEvent = Static<typeof MembershipEvent>;

// ---------- Onboarding ----------
export const ONBOARDING_STEPS = ['sso_login', 'device_key', 'github_link', 'vpn_profile', 'access_review'] as const;
export const OnboardingStepName = StringEnum([...ONBOARDING_STEPS]);
export type OnboardingStepName = Static<typeof OnboardingStepName>;

export const OnboardingStep = Type.Object({
  name: OnboardingStepName,
  status: StringEnum(['todo', 'done']),
  detail: Type.Optional(Type.String()),
  completedAt: Type.Optional(Type.String()),
});
export type OnboardingStep = Static<typeof OnboardingStep>;

export const ClosedDoor = Type.Object({
  door: Type.String(),
  action: Type.String(),
  closedAt: Type.String(),
});
export type ClosedDoor = Static<typeof ClosedDoor>;

export const Onboarding = Type.Object({
  person: Person,
  steps: Type.Array(OnboardingStep),
  closedDoors: Type.Array(ClosedDoor),
});
export type Onboarding = Static<typeof Onboarding>;

export const OnboardingSubmit = Type.Union([
  Type.Object({ step: Type.Literal('device_key'), publicKey: Type.String({ maxLength: 4096 }) }),
  Type.Object({ step: Type.Literal('github_link'), githubUsername: Type.String({ pattern: '^[A-Za-z0-9-]{1,39}$' }) }),
  Type.Object({ step: Type.Literal('vpn_profile') }),
  Type.Object({ step: Type.Literal('access_review') }),
]);
export type OnboardingSubmit = Static<typeof OnboardingSubmit>;

// ---------- Access ----------
export const AccessGrant = Type.Object({
  personId: Type.String(),
  targetId: Type.String(),
  permissionSet: Type.String(),
  status: StringEnum(['active', 'revoked']),
});
export type AccessGrant = Static<typeof AccessGrant>;

export const MyAccess = Type.Object({
  person: Type.Object({ id: Type.String(), name: Type.String(), team: Type.String() }),
  appRoles: Type.Array(Type.String()),
  accounts: Type.Array(
    Type.Object({
      targetId: Type.String(),
      name: Type.String(),
      environment: Environment,
      permissionSet: Type.String(),
      launchUrl: Type.String({ description: 'IAM Identity Center deep link — the app never brokers sessions' }),
    }),
  ),
  note: Type.String(),
});
export type MyAccess = Static<typeof MyAccess>;

// ---------- Read models ----------
export const HeatmapCell = Type.Object({
  environment: Environment,
  team: Type.String(),
  total: Type.Integer(),
  compliant: Type.Integer(),
});
export type HeatmapCell = Static<typeof HeatmapCell>;

export const Overview = Type.Object({
  percentCompliant: Type.Number(),
  totalTargets: Type.Integer(),
  heatmap: Type.Array(HeatmapCell),
  trend: Type.Array(Type.Object({ day: Type.String(), percentCompliant: Type.Number() })),
  critical: Type.Array(Type.Composite([Finding, Type.Object({ targetName: Type.String(), team: Type.String() })]), {
    description: 'The 8 most urgent open high/critical findings (a shortlist; the count is openHighOrCritical)',
  }),
  openHighOrCritical: Type.Integer({ description: 'All open (not waived) high/critical findings' }),
  expiringExceptions: Type.Array(Exception),
});
export type Overview = Static<typeof Overview>;

export const TargetDetail = Type.Object({
  target: TargetSummary,
  findings: Type.Array(Finding),
  exceptions: Type.Array(Exception),
  recentDeploys: Type.Array(
    Type.Object({ at: Type.String(), status: Type.String(), ref: Type.String(), runUrl: Type.String() }),
  ),
  consoleUrl: Type.String(),
});
export type TargetDetail = Static<typeof TargetDetail>;

export const AnalyticsRow = Type.Object({
  day: Type.String(),
  team: Type.String(),
  environment: Environment,
  rule: Type.String(),
  severity: Severity,
  openFindings: Type.Integer(),
});
export type AnalyticsRow = Static<typeof AnalyticsRow>;

export const Accepted = Type.Object({ accepted: Type.Literal(true), eventId: Type.String() });
export const ErrorBody = Type.Object({ error: Type.String(), message: Type.Optional(Type.String()) });

export const Nullable = <T extends TSchema>(t: T) => Type.Union([t, Type.Null()]);
