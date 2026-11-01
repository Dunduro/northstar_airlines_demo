/**
 * The platform's version catalog: which baseline and golden-path versions are supported.
 * In production this is read from the modules' release tags in git; here it is a constant that
 * matches terraform/modules/golden-paths (ecs-service v2.4.0, lambda-api v1.5.0, static-site v2.0.0).
 *
 * Policy: golden-path modules support the current major (N) and the one before (N-1).
 * The account baseline has a minimum supported version; being 2+ minors behind is flagged (low).
 */
export interface GoldenPathInfo {
  latest: string;
  supportedMajors: number[];
  deprecated: boolean;
  replacement?: string;
}

export const CATALOG = {
  baseline: { latest: '2.4.0', minimumSupported: '2.0.0' },
  goldenPaths: {
    'ecs-service': { latest: '2.4.0', supportedMajors: [2, 1], deprecated: false },
    'lambda-api': { latest: '1.5.0', supportedMajors: [1, 0], deprecated: false },
    // v2 moved from OAI to OAC and versioned bundle prefixes (breaking); v1 is N-1, still supported.
    'static-site': { latest: '2.0.0', supportedMajors: [2, 1], deprecated: false },
  } as Record<string, GoldenPathInfo>,
};

export type Catalog = typeof CATALOG;

export const major = (version: string): number => Number.parseInt(version.split('.')[0] ?? '0', 10);

/** Compare semver-ish "x.y.z" strings: negative if a < b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Minor versions behind latest within the same major (0 if on another major). */
export function minorsBehind(version: string, latest: string): number {
  if (major(version) !== major(latest)) return 0;
  return Math.max(0, Number(latest.split('.')[1]) - Number(version.split('.')[1]));
}
