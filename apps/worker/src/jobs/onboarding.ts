/** onboarding-step: joiner / mover / leaver, wizard steps and the SSO sign-in. */
import { toTarget, withTx, type Db, type DbClient } from '@northstar/db';
import { validatePublicKey, type AccessGrant, type OnboardingStep, type OnboardingSubmit, type Person } from '@northstar/shared';
import { completeStep, grantsFor, moveGrants, offboard, startOnboarding } from '../domain/onboarding.js';

async function loadGrants(c: DbClient, personId: string): Promise<AccessGrant[]> {
  const { rows } = await c.query('SELECT * FROM access_grants WHERE person_id = $1', [personId]);
  return rows.map((r) => ({ personId: r.person_id, targetId: r.target_id, permissionSet: r.permission_set, status: r.status }));
}

async function saveGrants(c: DbClient, grants: AccessGrant[]) {
  for (const g of grants) {
    await c.query(
      `INSERT INTO access_grants (person_id, target_id, permission_set, status) VALUES ($1,$2,$3,$4)
       ON CONFLICT (person_id, target_id) DO UPDATE SET permission_set = EXCLUDED.permission_set, status = EXCLUDED.status`,
      [g.personId, g.targetId, g.permissionSet, g.status],
    );
  }
}

async function loadSteps(c: DbClient, personId: string): Promise<OnboardingStep[] | null> {
  const { rows } = await c.query('SELECT steps FROM onboarding WHERE person_id = $1 FOR UPDATE', [personId]);
  return rows[0]?.steps ?? null;
}

const saveSteps = (c: DbClient, personId: string, steps: OnboardingStep[]) =>
  c.query('UPDATE onboarding SET steps = $2, updated_at = now() WHERE person_id = $1', [personId, JSON.stringify(steps)]);

async function grantsForPerson(c: DbClient, person: Pick<Person, 'id' | 'role' | 'team'>) {
  const { rows } = await c.query('SELECT * FROM targets');
  return grantsFor(person, rows.map(toTarget));
}

export async function handleOnboardingEvent(db: Db, eventId: string): Promise<void> {
  await withTx(db, async (c) => {
    const { rows } = await c.query('SELECT type, payload FROM events WHERE id = $1', [eventId]);
    if (!rows[0]) return;
    const { type, payload } = rows[0];

    switch (type) {
      case 'membership.joiner': {
        const p = payload.person;
        const person = { id: p.id, name: p.name ?? p.id, email: p.email ?? `${p.id}@northstar.example`, team: p.team, role: p.role ?? 'developer' };
        await c.query(
          `INSERT INTO people (id, name, email, team, role, status) VALUES ($1,$2,$3,$4,$5,'active')
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, team = EXCLUDED.team, role = EXCLUDED.role, status = 'active'`,
          [person.id, person.name, person.email, person.team, person.role],
        );
        await c.query(
          `INSERT INTO onboarding (person_id, steps) VALUES ($1, $2)
           ON CONFLICT (person_id) DO UPDATE SET closed_doors = '[]'`,
          [person.id, JSON.stringify(startOnboarding())],
        );
        await saveGrants(c, await grantsForPerson(c, person));
        return;
      }
      case 'membership.mover': {
        const p = payload.person;
        const { rows: found } = await c.query('UPDATE people SET team = COALESCE($2, team), role = COALESCE($3, role) WHERE id = $1 RETURNING *', [p.id, p.team ?? null, p.role ?? null]);
        if (!found[0]) return;
        await saveGrants(c, moveGrants(await loadGrants(c, p.id), await grantsForPerson(c, found[0])));
        return;
      }
      case 'membership.leaver': {
        const id = payload.person.id;
        const { rowCount } = await c.query(`UPDATE people SET status = 'left' WHERE id = $1`, [id]);
        if (!rowCount) return;
        const steps = (await loadSteps(c, id)) ?? [];
        const { grants, closedDoors } = offboard(steps, await loadGrants(c, id));
        await saveGrants(c, grants);
        await c.query('UPDATE onboarding SET closed_doors = $2, updated_at = now() WHERE person_id = $1', [id, JSON.stringify(closedDoors)]);
        return;
      }
      case 'auth.signin': {
        const steps = await loadSteps(c, payload.personId);
        if (steps) await saveSteps(c, payload.personId, completeStep(steps, 'sso_login', 'Signed in with Entra ID (MFA by Conditional Access)'));
        return;
      }
      case 'onboarding.step': {
        const steps = await loadSteps(c, payload.personId);
        if (!steps) return;
        const submit = payload.submit as OnboardingSubmit;
        let detail: string;
        if (submit.step === 'device_key') {
          const v = validatePublicKey(submit.publicKey);
          if (!v.ok) return; // the API already rejected invalid keys; never store junk
          detail = v.fingerprintHint;
        } else if (submit.step === 'github_link') detail = `@${submit.githubUsername}`;
        else if (submit.step === 'vpn_profile') detail = 'northstar-vpn.ovpn issued (cert bound to your Entra identity)';
        else {
          const active = (await loadGrants(c, payload.personId)).filter((g) => g.status === 'active');
          detail = `Reviewed access to ${active.length} accounts`;
        }
        await saveSteps(c, payload.personId, completeStep(steps, submit.step, detail));
      }
    }
  });
}
