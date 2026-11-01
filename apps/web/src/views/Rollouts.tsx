import { useState } from 'react';
import type { Rollout } from '@northstar/shared';
import { api, hasRole, useApi } from '../api';
import { Link } from '../router';
import { Card, Loading, Pill, when } from '../components';

export function RolloutsView({ id }: { id?: string }) {
  const { data: list, error } = useApi<Rollout[]>('/v1/rollouts', 1500);
  if (!list) return <Loading error={error} />;
  const current = list.find((r) => r.id === id) ?? list[0];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Rollouts</h1>
          <div className="muted">
            One change, every account, in waves: sandbox → dev → test → prod. The pipeline runs the waves and halts one
            above its failure threshold (or on any Prod failure); this view mirrors what it reports.
          </div>
        </div>
      </div>
      {!current ? (
        <Card><p className="muted">No rollouts yet. Try <code>npm run sim -- rollout region-lock</code>.</p></Card>
      ) : (
        <RolloutBoard rollout={current} />
      )}
      {list.length > 1 && (
        <div style={{ marginTop: '1.5rem' }}>
          <Card title="Earlier rollouts">
            <table>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id}>
                    <td><Link to={`/rollouts/${r.id}`}>{r.change.title}</Link><div className="small mono muted">{r.id}</div></td>
                    <td className="small">{when(r.createdAt)}</td>
                    <td><Pill kind={r.status} /></td>
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

function RolloutBoard({ rollout }: { rollout: Rollout }) {
  const [message, setMessage] = useState<string>();
  const halted = rollout.waves.find((w) => w.status === 'halted');

  async function retry() {
    try {
      await api(`/v1/rollouts/${rollout.id}/retry`, { method: 'POST' });
      setMessage('Retry queued: one apply-baseline.yml run per failed target. When they are green, the pipeline resumes the remaining waves.');
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  return (
    <>
      <Card
        title={<>{rollout.change.title} <Pill kind={rollout.status} /></>}
        action={halted && hasRole('operator') ? <button onClick={retry}>Retry failed targets</button> : undefined}
      >
        <div className="muted small">
          <span className="mono">{rollout.id}</span> · change <span className="mono">{rollout.change.ref}</span> · started {when(rollout.createdAt)} ·
          threshold {Math.round((rollout.waves[0]?.failureThreshold ?? 0) * 100)}% (any failure in prod)
        </div>
      </Card>
      {halted && (
        <div className="banner bad" style={{ marginTop: '1rem' }}>
          The pipeline halted the {halted.name} wave — the next wave will not start. Prod has not received this change.
        </div>
      )}
      {message && <div className="banner info" style={{ marginTop: '1rem' }}>{message}</div>}
      <div className="waves" style={{ marginTop: '1rem' }}>
        {rollout.waves.map((w) => {
          const ok = w.targets.filter((t) => t.status === 'succeeded').length;
          return (
            <div key={w.name} className={`wave ${w.status}`}>
              <div className="wave-head">
                <h3>{w.name}</h3>
                <Pill kind={w.status} />
              </div>
              <div className="small muted" style={{ marginBottom: '0.6rem' }}>{ok}/{w.targets.length} succeeded</div>
              {w.targets.map((t) => (
                <div key={t.targetId} className="wt">
                  <div className="name">
                    <Link to={`/accounts/${t.targetId}`}>{t.name}</Link>
                    <Pill kind={t.status} />
                  </div>
                  {t.attempts > 1 && <div className="small muted">attempt {t.attempts}</div>}
                  {t.error && <div className="err">{t.error}</div>}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}
