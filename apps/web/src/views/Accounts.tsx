import { useState } from 'react';
import { CATALOG, type FindingSource, type TargetDetail, type TargetSummary } from '@northstar/shared';
import { api, hasRole, useApi } from '../api';
import { Link, useLocation } from '../router';
import { Card, ExpiryPill, Loading, Pill, when } from '../components';

export function AccountList() {
  const { search } = useLocation();
  const { data, error } = useApi<TargetSummary[]>(`/v1/targets${search}`, 5000);
  const filters = new URLSearchParams(search);
  if (!data) return <Loading error={error} />;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Accounts</h1>
          <div className="muted">
            {[...filters.entries()].map(([k, v]) => `${k}: ${v}`).join(' · ') || 'All accounts from the registry'}
            {filters.size > 0 && <> · <Link to="/accounts">clear filter</Link></>}
          </div>
        </div>
      </div>
      <Card>
        <table>
          <thead>
            <tr><th>Account</th><th>Env</th><th>Team</th><th>Baseline</th><th>Golden paths</th><th>Status</th></tr>
          </thead>
          <tbody>
            {data.map((t) => (
              <tr key={t.id}>
                <td><Link to={`/accounts/${t.id}`}>{t.name}</Link><div className="small mono muted">{t.id}</div></td>
                <td>{t.environment}</td>
                <td>{t.team}</td>
                <td className="mono">{t.baselineVersion}</td>
                <td className="small">{t.flavours.join(', ') || '—'}</td>
                <td>
                  {t.compliant ? <Pill kind="ok">compliant</Pill> : <Pill kind="bad">non-compliant</Pill>}{' '}
                  {t.openFindings > 0 && <span className="small muted">{t.openFindings} open</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

const SOURCES: Array<[FindingSource, string]> = [
  ['drift', 'Terraform drift (nightly plan)'],
  ['policy', 'Policy checks in CI (Checkov / OPA)'],
  ['config', 'AWS Config / Security Hub'],
  ['platform', 'Platform rules (owned by this app)'],
];

export function AccountDetail({ id }: { id: string }) {
  const { data, error, reload } = useApi<TargetDetail>(`/v1/targets/${id}`, 3000);
  const [queued, setQueued] = useState<string>();
  if (!data) return <Loading error={error} />;
  const t = data.target;

  async function reapply() {
    const res = await api<{ eventId: string }>(`/v1/targets/${t.id}/reapply`, { method: 'POST' });
    setQueued(`Queued (event ${res.eventId.slice(0, 8)}): the worker dispatches GitHub workflow "apply-baseline.yml" for ${t.name}. The pipeline applies; the app never touches AWS.`);
    setTimeout(reload, 2500);
  }

  const versions: Array<[string, string, string]> = [
    ['account-baseline', t.baselineVersion, CATALOG.baseline.latest],
    ...Object.entries(t.moduleVersions).map(([m, v]): [string, string, string] => [m, v, CATALOG.goldenPaths[m]?.latest ?? '?']),
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t.name}</h1>
          <div className="muted">
            <span className="mono">{t.id}</span> · {t.environment} · team {t.team} · owner {t.owner} · OU {t.ou}
          </div>
        </div>
        <div className="row">
          {t.compliant ? <Pill kind="ok">compliant</Pill> : <Pill kind="bad">non-compliant</Pill>}
          <a className="button secondary" href={data.consoleUrl} target="_blank" rel="noreferrer">
            Open in AWS ↗
          </a>
          {hasRole('operator') && (
            <button onClick={reapply} title="Triggers the pipeline via workflow_dispatch">
              Re-apply baseline
            </button>
          )}
        </div>
      </div>
      {queued && <div className="banner info">{queued}</div>}

      <div className="grid cols-2">
        <Card title="Versions">
          <table>
            <thead><tr><th>Module</th><th>Deployed</th><th>Latest</th></tr></thead>
            <tbody>
              {versions.map(([m, v, latest]) => (
                <tr key={m}>
                  <td>{m}{CATALOG.goldenPaths[m]?.deprecated && <> <Pill kind="warn">deprecated</Pill></>}</td>
                  <td className="mono">{v}</td>
                  <td className="mono muted">{latest}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">Golden paths: {t.flavours.join(', ') || 'none'}</p>
        </Card>

        <Card title="Recent deploys">
          {data.recentDeploys.length === 0 ? <p className="muted">No deploys reported yet.</p> : (
            <table>
              <tbody>
                {data.recentDeploys.map((d) => (
                  <tr key={d.at + d.runUrl}>
                    <td><Pill kind={d.status} /></td>
                    <td className="small">{when(d.at)}</td>
                    <td className="small mono">{d.ref}</td>
                    <td className="small"><a href={d.runUrl} target="_blank" rel="noreferrer">run ↗</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <h2 style={{ marginTop: '1.5rem' }}>Findings by source</h2>
      <div className="grid cols-2">
        {SOURCES.map(([source, label]) => {
          const list = data.findings.filter((f) => f.source === source);
          return (
            <Card key={source} title={label}>
              {list.length === 0 ? <p className="muted">No findings.</p> : (
                <table>
                  <tbody>
                    {list.map((f) => (
                      <tr key={f.id} style={{ opacity: f.status === 'resolved' ? 0.55 : 1 }}>
                        <td><Pill kind={f.severity} /></td>
                        <td>
                          <div className="mono">{f.rule}</div>
                          <div className="small muted mono">{f.resource}</div>
                        </td>
                        <td><Pill kind={f.status} /></td>
                        <td className="small">{f.link && <a href={f.link} target="_blank" rel="noreferrer">original ↗</a>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          );
        })}
      </div>

      {data.exceptions.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <Card title="Exceptions on this account">
            <table>
              <tbody>
                {data.exceptions.map((e) => (
                  <tr key={e.id}>
                    <td className="mono">{e.rule}</td>
                    <td>{e.reason}<div className="small muted">Compensating control: {e.compensatingControl}</div></td>
                    <td><ExpiryPill expiresAt={e.expiresAt} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </>
  );
}
