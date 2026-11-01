import { TEAMS, type Finding, type Severity } from './schemas.js';

export const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

/** Compliance per target = no open findings of severity >= high (waived findings do not count). */
export function isCompliant(findings: Pick<Finding, 'status' | 'severity'>[]): boolean {
  return !findings.some((f) => f.status === 'open' && SEVERITY_RANK[f.severity] >= SEVERITY_RANK.high);
}

export function highestSeverity(findings: Pick<Finding, 'status' | 'severity'>[]): Severity | null {
  let best: Severity | null = null;
  for (const f of findings) {
    if (f.status !== 'open') continue;
    if (!best || SEVERITY_RANK[f.severity] > SEVERITY_RANK[best]) best = f.severity;
  }
  return best;
}

/**
 * Heatmap columns: every team that owns an account. The well-known teams keep their fixed order;
 * any other team from the registry follows alphabetically, so a new team is never hidden.
 */
export function heatmapTeams(cells: { team: string }[]): string[] {
  const present = new Set(cells.map((c) => c.team));
  const known: readonly string[] = TEAMS;
  return [...known.filter((t) => present.has(t)), ...[...present].filter((t) => !known.includes(t)).sort()];
}
