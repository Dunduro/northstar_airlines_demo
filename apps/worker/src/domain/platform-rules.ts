/**
 * Platform rules — the ONLY rules this app owns. Everything else (drift, Checkov/OPA, AWS Config)
 * is evaluated by the tools that already exist; the dashboard just aggregates their findings.
 *
 * Each rule is a small, versioned, pure function: (target, exceptions, now) -> findings.
 */
import { CATALOG, compareVersions, major, minorsBehind, type Catalog, type Exception, type Severity, type Target } from '@northstar/shared';

export interface PlatformFinding {
  rule: string;
  severity: Severity;
  resource: string;
}

export interface RuleContext {
  target: Target;
  exceptions: Exception[];
  now: Date;
  catalog: Catalog;
}

export interface PlatformRule {
  id: string;
  version: string;
  description: string;
  evaluate(ctx: RuleContext): PlatformFinding[];
}

export const EXPIRY_WARNING_DAYS = 14;
const DAY_MS = 86_400_000;

export const rules: PlatformRule[] = [
  {
    id: 'baseline-version-supported',
    version: '1.0.0',
    description: 'Account baseline is at or above the minimum supported version; 2+ minors behind is flagged',
    evaluate: ({ target, catalog }) => {
      const v = target.baselineVersion;
      if (compareVersions(v, catalog.baseline.minimumSupported) < 0) {
        return [{ rule: 'baseline-version-supported', severity: 'high', resource: `baseline@${v}` }];
      }
      if (minorsBehind(v, catalog.baseline.latest) >= 2) {
        return [{ rule: 'baseline-version-behind', severity: 'low', resource: `baseline@${v}` }];
      }
      return [];
    },
  },
  {
    id: 'module-version-supported',
    version: '1.0.0',
    description: 'Golden-path modules are on a supported major',
    evaluate: ({ target, catalog }) =>
      Object.entries(target.moduleVersions).flatMap(([module, version]) => {
        const info = catalog.goldenPaths[module];
        if (!info || info.supportedMajors.includes(major(version))) return [];
        return [{ rule: 'module-version-supported', severity: 'high' as const, resource: `${module}@${version}` }];
      }),
  },
  {
    id: 'golden-path-not-deprecated',
    version: '1.0.0',
    description: 'Account does not use a deprecated golden path',
    evaluate: ({ target, catalog }) =>
      target.flavours
        .filter((f) => catalog.goldenPaths[f]?.deprecated)
        .map((f) => ({
          rule: 'golden-path-not-deprecated',
          severity: 'medium' as const,
          resource: `${f} -> ${catalog.goldenPaths[f]!.replacement ?? 'see catalog'}`,
        })),
  },
  {
    id: 'owner-and-team-set',
    version: '1.0.0',
    description: 'Every account has an owner and a team (ownerless accounts are escalated)',
    evaluate: ({ target }) =>
      !target.owner.trim() || !target.team.trim() || target.team === 'unknown'
        ? [{ rule: 'owner-and-team-set', severity: 'high', resource: 'tags/owner,team' }]
        : [],
  },
  {
    id: 'exception-valid',
    version: '1.0.0',
    description: 'Exceptions are still valid; warn 14 days before expiry',
    evaluate: ({ target, exceptions, now }) =>
      exceptions
        .filter((e) => e.targetId === target.id)
        .flatMap((e): PlatformFinding[] => {
          const msLeft = new Date(e.expiresAt).getTime() - now.getTime();
          if (msLeft <= 0) return [{ rule: 'exception-expired', severity: 'high', resource: `exception/${e.rule}` }];
          if (msLeft <= EXPIRY_WARNING_DAYS * DAY_MS) return [{ rule: 'exception-expiring', severity: 'medium', resource: `exception/${e.rule}` }];
          return [];
        }),
  },
];

export function runPlatformRules(
  target: Target,
  exceptions: Exception[],
  now = new Date(),
  catalog: Catalog = CATALOG,
): PlatformFinding[] {
  return rules.flatMap((r) => r.evaluate({ target, exceptions, now, catalog }));
}

/**
 * A finding may only be waived by a registered, unexpired exception for the same target + rule.
 * When the exception expires the finding re-opens.
 */
export function waiverStatus(
  finding: { targetId: string; rule: string; status: 'open' | 'resolved' | 'waived' },
  exceptions: Exception[],
  now = new Date(),
): 'open' | 'resolved' | 'waived' {
  if (finding.status === 'resolved') return 'resolved';
  const active = exceptions.some(
    (e) => e.targetId === finding.targetId && e.rule === finding.rule && new Date(e.expiresAt) > now,
  );
  return active ? 'waived' : 'open';
}
