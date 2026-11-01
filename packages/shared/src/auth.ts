import type { PersonRole, Role } from './schemas.js';

/**
 * Entra ID security groups -> app roles. In production these are app-role assignments on the
 * Entra app registration and arrive in the token's `roles` claim; the mapping is shown here so
 * the PoC is readable.
 */
export const GROUP_ROLES: Record<string, Role> = {
  'sg-northstar-engineering': 'viewer',
  'sg-northstar-platform': 'operator',
  'sg-northstar-security': 'admin',
};

export function groupsFor(person: { team: string; role: PersonRole }): string[] {
  const groups = ['sg-northstar-engineering', `sg-team-${person.team}`];
  if (person.role === 'platform-engineer') groups.push('sg-northstar-platform');
  if (person.role === 'security') groups.push('sg-northstar-security');
  return groups;
}

export function rolesFromGroups(groups: string[]): Role[] {
  return [...new Set(groups.map((g) => GROUP_ROLES[g]).filter((r): r is Role => Boolean(r)))];
}

/** Scope carried by the BI service principal's app-only token. */
export const ANALYTICS_SCOPE = 'analytics.read';

/** Simulated Entra token claims (same names as a real Entra ID access token). */
export interface TokenClaims {
  oid: string;
  name: string;
  preferred_username?: string;
  groups: string[];
  roles: string[];
}

const PORTAL = 'https://northstar.awsapps.com/start';

/** IAM Identity Center deep link for an account + permission set. Show and link, never broker. */
export const identityCenterLink = (accountId: string, permissionSet: string) =>
  `${PORTAL}/#/console?account_id=${accountId}&role_name=${encodeURIComponent(permissionSet)}`;
