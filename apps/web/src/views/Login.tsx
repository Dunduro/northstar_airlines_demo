import { useState } from 'react';
import { api, session, useApi, type Claims } from '../api';
import { navigate } from '../router';
import type { Onboarding } from '@northstar/shared';

interface Persona {
  id: string;
  name: string;
  team: string;
  role: string;
}

/** SIMULATED Entra ID sign-in. Production: OIDC (auth code + PKCE) against the Entra tenant. */
export function Login() {
  const { data, error } = useApi<Persona[]>('/v1/auth/personas', 3000);
  const [failure, setFailure] = useState<string>();

  async function signIn(personId: string) {
    try {
      const res = await api<{ token: string; claims: Claims }>('/v1/auth/dev-login', { method: 'POST', body: { personId } });
      session.set(res.token, res.claims);
      // New joiners land in the onboarding wizard; everyone else on the overview.
      const ob = await api<Onboarding>(`/v1/onboarding/${personId}`).catch(() => null);
      const unfinished = ob?.steps.some((s) => s.name !== 'sso_login' && s.status === 'todo');
      navigate(unfinished ? '/onboarding' : '/');
    } catch (e) {
      setFailure((e as Error).message);
    }
  }

  return (
    <div className="login">
      <h1>NorthStar Platform</h1>
      <p className="muted">The command center for the landing zone: compliance, rollouts, access and onboarding.</p>
      <div className="banner info">
        Simulated Microsoft Entra ID sign-in — a stand-in for the PoC. Roles come from Entra group claims
        (viewer · operator · admin). No passwords or MFA live in this app.
      </div>
      <h2>Choose who you are</h2>
      {error && <p className="error">{error}</p>}
      {failure && <p className="error">{failure}</p>}
      {data && data.length === 0 && <p className="muted">No people yet — run <code>npm run demo:seed</code>.</p>}
      <div className="personas">
        {data?.map((p) => (
          <button key={p.id} className="persona" onClick={() => signIn(p.id)}>
            <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{p.name}</div>
            <div className="muted small">
              {p.role} · {p.team}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
