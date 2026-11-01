/**
 * Joiner / mover / leaver. Roles, not people: access follows from (role, team, environment),
 * so joining, moving and leaving are group changes, never hand-made grants.
 */
import {
  ONBOARDING_STEPS,
  type AccessGrant,
  type ClosedDoor,
  type OnboardingStep,
  type OnboardingStepName,
  type Person,
  type PersonRole,
  type Target,
} from '@northstar/shared';

/** Identity Center permission set for a role in an environment (architecture section 2.2). */
export function permissionSetFor(role: PersonRole, target: Pick<Target, 'environment' | 'team'>, team: string): string | null {
  if (role === 'security') return 'SecurityAudit';
  if (role === 'platform-engineer') return target.environment === 'prod' || target.environment === 'core' ? 'ReadOnly' : 'PlatformEngineer';
  if (target.team !== team) return null; // ABAC: the team decides *where*
  if (target.environment === 'prod') return 'ReadOnly'; // no standing write access to Prod (JIT via PIM)
  return role === 'lead' ? 'LeadDeveloper' : 'Developer';
}

export function grantsFor(person: Pick<Person, 'id' | 'role' | 'team'>, targets: Target[]): AccessGrant[] {
  return targets.flatMap((t) => {
    const permissionSet = permissionSetFor(person.role, t, person.team);
    return permissionSet ? [{ personId: person.id, targetId: t.id, permissionSet, status: 'active' as const }] : [];
  });
}

/** Joiner: the Entra account exists (SCIM), so SSO is ready; the rest is the wizard. */
export function startOnboarding(): OnboardingStep[] {
  return ONBOARDING_STEPS.map((name) => ({ name, status: 'todo' as const }));
}

export function completeStep(steps: OnboardingStep[], name: OnboardingStepName, detail: string | undefined, now = new Date()): OnboardingStep[] {
  return steps.map((s) => (s.name === name ? { ...s, status: 'done', detail, completedAt: s.completedAt ?? now.toISOString() } : s));
}

/** Mover: access follows the new team automatically; old access is removed. */
export function moveGrants(current: AccessGrant[], next: AccessGrant[]): AccessGrant[] {
  const nextIds = new Set(next.map((g) => g.targetId));
  const revoked = current.filter((g) => !nextIds.has(g.targetId)).map((g) => ({ ...g, status: 'revoked' as const }));
  return [...next, ...revoked];
}

/** Leaver: revoke everything and record each door as it closes. */
export function offboard(
  steps: OnboardingStep[],
  grants: AccessGrant[],
  now = new Date(),
): { grants: AccessGrant[]; closedDoors: ClosedDoor[] } {
  const at = now.toISOString();
  const step = (n: OnboardingStepName) => steps.find((s) => s.name === n);
  const active = grants.filter((g) => g.status === 'active');
  const doors: ClosedDoor[] = [
    { door: 'Entra ID account', action: 'disabled; refresh tokens revoked (sign-in to every app stops)', closedAt: at },
    { door: `AWS access (${active.length} account${active.length === 1 ? '' : 's'})`, action: 'Identity Center assignments removed via SCIM; active sessions revoked', closedAt: at },
    { door: 'GitHub', action: step('github_link')?.detail ? `${step('github_link')!.detail} removed from org and teams` : 'no linked account', closedAt: at },
    { door: 'SSH device key', action: step('device_key')?.detail ? `key ${step('device_key')!.detail} removed from bastion/CA` : 'no key registered', closedAt: at },
    { door: 'VPN profile', action: step('vpn_profile')?.status === 'done' ? 'certificate revoked' : 'no profile issued', closedAt: at },
    { door: 'Platform dashboard', action: 'app roles removed with the Entra groups', closedAt: at },
  ];
  return { grants: grants.map((g) => ({ ...g, status: 'revoked' })), closedDoors: doors };
}

export const everyDoorClosed = (grants: AccessGrant[], closedDoors: ClosedDoor[]) =>
  closedDoors.length > 0 && grants.every((g) => g.status === 'revoked');
