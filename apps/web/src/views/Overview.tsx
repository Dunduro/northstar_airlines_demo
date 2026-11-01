import { ENVIRONMENTS, heatmapTeams, type Overview } from '@northstar/shared';
import { useApi } from '../api';
import { Link } from '../router';
import { Card, ExpiryPill, Loading, Pill, Sparkline } from '../components';

export function OverviewView() {
  const { data, error } = useApi<Overview>('/v1/overview', 3000);
  if (!data) return <Loading error={error} />;

  const cell = (env: string, team: string) => data.heatmap.find((c) => c.environment === env && c.team === team);
  const envs = ENVIRONMENTS.filter((e) => data.heatmap.some((c) => c.environment === e));
  const teams = heatmapTeams(data.heatmap);
  const nonCompliant = data.heatmap.reduce((n, c) => n + c.total - c.compliant, 0);
  const first = data.trend[0]?.percentCompliant ?? data.percentCompliant;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Estate overview</h1>
          <div className="muted">Compliant = no open high or critical finding that is not covered by an exception.</div>
        </div>
      </div>

      <div className="grid kpis" style={{ marginBottom: '1rem' }}>
        <div className="card kpi">
          <div className="value">{data.percentCompliant}%</div>
          <div className="label">accounts compliant ({data.totalTargets} accounts)</div>
        </div>
        <div className="card kpi">
          <div className="value" style={{ color: nonCompliant ? 'var(--bad)' : 'var(--ok)' }}>{nonCompliant}</div>
          <div className="label">accounts need attention</div>
        </div>
        <div className="card kpi">
          <div className="value">{data.openHighOrCritical}</div>
          <div className="label">open high / critical findings</div>
        </div>
        <div className="card kpi">
          <div className="value" style={{ color: data.expiringExceptions.length ? 'var(--warn)' : undefined }}>{data.expiringExceptions.length}</div>
          <div className="label">exceptions expiring ≤ 14 days or expired</div>
        </div>
      </div>

      <div className="grid cols-2">
        <div style={{ gridColumn: '1 / -1' }}>
          <Card title="Compliance by environment × team">
            <table className="heatmap">
              <thead>
                <tr>
                  <th>Env</th>
                  {teams.map((t) => (
                    <th key={t}>{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {envs.map((env) => (
                  <tr key={env}>
                    <td style={{ fontWeight: 600, textTransform: 'capitalize' }}>{env}</td>
                    {teams.map((team) => {
                      const c = cell(env, team);
                      if (!c) return <td key={team}><span className="cell empty">–</span></td>;
                      const kind = c.compliant === c.total ? 'ok' : c.compliant === 0 ? 'bad' : 'partial';
                      return (
                        <td key={team}>
                          <Link to={`/accounts?environment=${env}&team=${team}`} className={`cell ${kind}`}>
                            {Math.round((c.compliant / c.total) * 100)}%<small>{c.compliant}/{c.total}</small>
                          </Link>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>

        <Card title="Last 30 days">
          <Sparkline points={data.trend} />
          <p className="muted small">
            {first}% → {data.percentCompliant}% compliant. Operational trend only — long-term reporting lives in BI
            (anonymised feed at <span className="mono">/v1/analytics/compliance-daily</span>).
          </p>
        </Card>

        <Card title="Needs attention first">
          {data.critical.length === 0 ? (
            <p className="muted">Nothing high or critical is open.</p>
          ) : (
            <table>
              <tbody>
                {data.critical.map((f) => (
                  <tr key={f.id}>
                    <td><Pill kind={f.severity} /></td>
                    <td>
                      <Link to={`/accounts/${f.targetId}`}>{f.targetName}</Link>
                      <div className="small muted">{f.source} · {f.rule}</div>
                      <div className="small mono">{f.resource}</div>
                    </td>
                    <td className="small">{f.team}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Exceptions expiring or expired" action={<Link to="/exceptions">All exceptions →</Link>}>
          {data.expiringExceptions.length === 0 ? (
            <p className="muted">None in the next 14 days.</p>
          ) : (
            <table>
              <tbody>
                {data.expiringExceptions.map((e) => (
                  <tr key={e.id}>
                    <td><ExpiryPill expiresAt={e.expiresAt} /></td>
                    <td>
                      <Link to={`/accounts/${e.targetId}`} className="mono">{e.rule}</Link>
                      <div className="small muted">{e.owner}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
