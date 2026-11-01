import { describe, expect, it } from 'vitest';
import { validatePublicKey, type Target } from '@northstar/shared';
import { completeStep, everyDoorClosed, grantsFor, moveGrants, offboard, startOnboarding } from '../src/domain/onboarding.js';

const target = (name: string, team: string, environment: Target['environment']): Target => ({
  id: name,
  name,
  cloud: 'aws',
  environment,
  team,
  owner: 'o',
  ou: 'x',
  flavours: [],
  baselineVersion: '2.4.0',
  moduleVersions: {},
});
const estate = ['payments', 'cargo'].flatMap((team) =>
  (['sandbox', 'dev', 'test', 'prod'] as const).map((env) => target(`${team}-${env}`, team, env)),
);

describe('joiner', () => {
  it('a developer gets Developer in their own team non-prod and ReadOnly in prod, nothing elsewhere', () => {
    const grants = grantsFor({ id: 'jan', role: 'developer', team: 'payments' }, estate);
    expect(grants.map((g) => `${g.targetId}:${g.permissionSet}`)).toEqual([
      'payments-sandbox:Developer',
      'payments-dev:Developer',
      'payments-test:Developer',
      'payments-prod:ReadOnly',
    ]);
  });

  it('starts the wizard with every step to do, and completes steps', () => {
    let steps = startOnboarding();
    expect(steps.map((s) => s.name)).toEqual(['sso_login', 'device_key', 'github_link', 'vpn_profile', 'access_review']);
    steps = completeStep(steps, 'sso_login', 'ok');
    expect(steps[0]).toMatchObject({ status: 'done', detail: 'ok' });
    expect(steps.slice(1).every((s) => s.status === 'todo')).toBe(true);
  });

  it('accepts public SSH keys and rejects private keys', () => {
    expect(validatePublicKey('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGx0aGlzaXNhZGVtb2tleQ jan@laptop').ok).toBe(true);
    const priv = validatePublicKey('-----BEGIN OPENSSH PRIVATE KEY-----\nabc');
    expect(priv.ok).toBe(false);
    expect(validatePublicKey('hello').ok).toBe(false);
  });
});

describe('mover', () => {
  it('access follows the new team; old access is revoked', () => {
    const before = grantsFor({ id: 'jan', role: 'developer', team: 'payments' }, estate);
    const after = moveGrants(before, grantsFor({ id: 'jan', role: 'developer', team: 'cargo' }, estate));
    expect(after.filter((g) => g.status === 'active').every((g) => g.targetId.startsWith('cargo'))).toBe(true);
    expect(after.filter((g) => g.status === 'revoked').map((g) => g.targetId)).toHaveLength(4);
  });
});

describe('leaver', () => {
  it('revokes everything and closes every door', () => {
    let steps = startOnboarding();
    steps = completeStep(steps, 'github_link', '@jan');
    steps = completeStep(steps, 'device_key', 'ssh-ed25519 …abc');
    const grants = grantsFor({ id: 'jan', role: 'developer', team: 'payments' }, estate);
    const result = offboard(steps, grants, new Date('2026-11-01T10:00:00Z'));
    expect(result.grants.every((g) => g.status === 'revoked')).toBe(true);
    expect(result.closedDoors.map((d) => d.door)).toEqual([
      'Entra ID account',
      'AWS access (4 accounts)',
      'GitHub',
      'SSH device key',
      'VPN profile',
      'Platform dashboard',
    ]);
    expect(result.closedDoors.find((d) => d.door === 'GitHub')!.action).toContain('@jan');
    expect(everyDoorClosed(result.grants, result.closedDoors)).toBe(true);
    expect(everyDoorClosed(grants, [])).toBe(false);
  });
});
