import { useState } from 'react';
import type { MyAccess, Onboarding, OnboardingStepName, Person } from '@northstar/shared';
import { api, useApi } from '../api';
import { Link } from '../router';
import { Card, Loading, Pill, when } from '../components';

const LABELS: Record<OnboardingStepName, [string, string]> = {
  sso_login: ['Sign in with SSO', 'Your Entra ID account was created by HR; MFA is enforced by Conditional Access.'],
  device_key: ['Register your device key', 'Paste your PUBLIC SSH key (the .pub file). Never your private key.'],
  github_link: ['Link GitHub', 'Your GitHub Enterprise account joins your team via SAML/SCIM.'],
  vpn_profile: ['Download VPN profile', 'AWS Client VPN, certificate bound to your Entra identity.'],
  access_review: ['Review your access', 'What you can reach, in which account, with which role.'],
};

export function OnboardingView({ personId, self = false }: { personId: string; self?: boolean }) {
  const { data, error, reload } = useApi<Onboarding>(`/v1/onboarding/${personId}`, 1500);
  if (!data) return <Loading error={error} />;
  if (data.closedDoors.length > 0) return <DoorsClosed data={data} />;

  const current = data.steps.find((s) => s.status === 'todo')?.name;
  const done = data.steps.filter((s) => s.status === 'done').length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{self ? `Welcome, ${data.person.name}` : `Onboarding: ${data.person.name}`}</h1>
          <div className="muted">
            {data.person.role} · team {data.person.team} · step {Math.min(done + 1, data.steps.length)} of {data.steps.length}
          </div>
        </div>
        {done === data.steps.length && <Pill kind="ok">onboarded</Pill>}
      </div>
      {done === data.steps.length && self && (
        <div className="banner ok">
          You are set up. Your access is in <Link to="/access">My access</Link>; from now on alerts find you in Teams.
        </div>
      )}
      <ol className="steps">
        {data.steps.map((s, i) => (
          <li key={s.name} className={`step ${s.status} ${s.name === current ? 'current' : ''}`}>
            <div className="num">{s.status === 'done' ? '✓' : i + 1}</div>
            <div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0 }}>{LABELS[s.name][0]}</h3>
                {s.status === 'done' && <span className="small muted">{s.completedAt && when(s.completedAt)}</span>}
              </div>
              <div className="muted small">{s.status === 'done' ? s.detail : LABELS[s.name][1]}</div>
              {self && s.name === current && <StepForm step={s.name} personId={personId} onDone={reload} />}
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

function StepForm({ step, personId, onDone }: { step: OnboardingStepName; personId: string; onDone: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const access = useApi<MyAccess>(step === 'access_review' ? '/v1/me/access' : null);

  async function submit(body: Record<string, string>) {
    setBusy(true);
    setErr(undefined);
    try {
      await api(`/v1/onboarding/${personId}`, { method: 'POST', body: { step, ...body } });
      setTimeout(onDone, 800); // accepted (202); the worker completes the step a moment later
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function downloadVpn() {
    const profile = `# NorthStar AWS Client VPN — PoC placeholder (no keys inside)\nclient\ndev tun\nproto udp\nremote cvpn-endpoint.northstar.example 443\nauth-federate\n`;
    const url = URL.createObjectURL(new Blob([profile], { type: 'application/x-openvpn-profile' }));
    Object.assign(document.createElement('a'), { href: url, download: 'northstar-vpn.ovpn' }).click();
    URL.revokeObjectURL(url);
    void submit({});
  }

  return (
    <div style={{ marginTop: '0.75rem' }}>
      {step === 'sso_login' && <p className="muted small">Completing sign-in…</p>}
      {step === 'device_key' && (
        <>
          <label htmlFor="key">Public key</label>
          <textarea id="key" value={value} onChange={(e) => setValue(e.target.value)} placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA… you@laptop" />
          <div className="row" style={{ marginTop: '0.5rem' }}>
            <button disabled={busy || !value.trim()} onClick={() => submit({ publicKey: value.trim() })}>Register key</button>
            <span className="small muted">Tip: <span className="mono">cat ~/.ssh/id_ed25519.pub</span></span>
          </div>
        </>
      )}
      {step === 'github_link' && (
        <>
          <label htmlFor="gh">GitHub username</label>
          <div className="row">
            <input id="gh" style={{ maxWidth: 320 }} value={value} onChange={(e) => setValue(e.target.value)} placeholder="jan-ns" />
            <button disabled={busy || !value.trim()} onClick={() => submit({ githubUsername: value.trim() })}>Link GitHub</button>
          </div>
        </>
      )}
      {step === 'vpn_profile' && <button disabled={busy} onClick={downloadVpn}>Download VPN profile</button>}
      {step === 'access_review' && (
        <>
          {access.data && (
            <table style={{ marginBottom: '0.75rem' }}>
              <tbody>
                {access.data.accounts.map((a) => (
                  <tr key={a.targetId}>
                    <td>{a.name}</td>
                    <td><Pill kind="neutral">{a.permissionSet}</Pill></td>
                    <td><a href={a.launchUrl} target="_blank" rel="noreferrer">Open in AWS ↗</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button disabled={busy} onClick={() => submit({})}>This is what I expected</button>
        </>
      )}
      {err && <p className="error">{err}</p>}
    </div>
  );
}

function DoorsClosed({ data }: { data: Onboarding }) {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{data.person.name} has left</h1>
          <div className="muted">HR marked the leaver → Entra disabled the account → everything below was revoked automatically.</div>
        </div>
      </div>
      <div className="banner ok">Every door closed ({data.closedDoors.length}/{data.closedDoors.length}).</div>
      <Card>
        <ul className="doors">
          {data.closedDoors.map((d) => (
            <li key={d.door}>
              <Pill kind="ok">closed</Pill>
              <div>
                <strong>{d.door}</strong>
                <div className="small muted">{d.action} · {when(d.closedAt)}</div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

export function PeopleView() {
  const { data, error } = useApi<Person[]>('/v1/people', 3000);
  if (!data) return <Loading error={error} />;
  return (
    <>
      <div className="page-head"><h1>People</h1></div>
      <Card>
        <table>
          <thead><tr><th>Name</th><th>Team</th><th>Role</th><th>Status</th></tr></thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.id}>
                <td><Link to={`/people/${p.id}`}>{p.name}</Link><div className="small muted">{p.email}</div></td>
                <td>{p.team}</td>
                <td>{p.role}</td>
                <td>{p.status === 'active' ? <Pill kind="ok">active</Pill> : <Pill kind="neutral">left</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
