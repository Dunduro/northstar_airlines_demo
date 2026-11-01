/**
 * The dashboard's template catalog must say exactly what the templates themselves say: one
 * entry per templates/<id>/, matching each platform.yaml, on the latest golden-path minor.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOG, TEMPLATES } from '../src/index.js';

const root = join(import.meta.dirname, '..', '..', '..', 'templates');

/** platform.yaml is flat `key: value`; no YAML library needed for what we compare. */
function manifest(id: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(join(root, id, 'platform.yaml'), 'utf8').split('\n')) {
    const m = /^([a-z-]+):\s*(.+?)\s*$/.exec(line);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

describe('template catalog', () => {
  const dirs = readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory()).sort();

  it('lists every template directory, and nothing else', () => {
    expect(TEMPLATES.map((t) => t.id).sort()).toEqual(dirs);
  });

  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s matches its platform.yaml', (id, t) => {
    const m = manifest(id);
    expect(m.template).toBe(`${id}@1.0`);
    expect(m.flavour).toBe(`${t.goldenPath}@${t.moduleVersion}`);
    expect(m.language).toBe(t.language);
    expect(m.framework).toBe(t.framework);
    if (t.runtime) expect(m.runtime).toBe(t.runtime);
  });

  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s pins the latest minor of its golden path, in infra/ too', (id, t) => {
    const latest = CATALOG.goldenPaths[t.goldenPath]!.latest.split('.').slice(0, 2).join('.');
    expect(t.moduleVersion).toBe(latest);
    const tf = readFileSync(join(root, id, 'infra', 'main.tf'), 'utf8');
    expect(tf).toContain(`source  = "registry.northstar.internal/platform/${t.goldenPath}/aws"`);
    expect(tf).toContain(`version = "~> ${t.moduleVersion}"`);
  });

  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s calls the platform workflows instead of carrying deploy logic', (id, t) => {
    const ci = readFileSync(join(root, id, '.github', 'workflows', 'ci.yml'), 'utf8');
    const deploy = readFileSync(join(root, id, '.github', 'workflows', 'deploy.yml'), 'utf8');
    expect(ci).toContain(`uses: northstar/platform-workflows/.github/workflows/${t.buildWorkflow}@v3`);
    expect(deploy).toContain('uses: northstar/platform-workflows/.github/workflows/reusable-deploy.yml@v3');
    expect(ci + deploy).not.toMatch(/aws-actions\/configure-aws-credentials|terraform apply/);
  });
});
