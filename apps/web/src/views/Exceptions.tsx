import type { Exception, TargetSummary } from '@northstar/shared';
import { useApi } from '../api';
import { Link } from '../router';
import { Card, ExpiryPill, Loading, daysUntil, when } from '../components';

export function ExceptionsView() {
  const { data, error } = useApi<Exception[]>('/v1/exceptions', 5000);
  const { data: targets } = useApi<TargetSummary[]>('/v1/targets');
  if (!data) return <Loading error={error} />;
  const name = (id: string) => targets?.find((t) => t.id === id)?.name ?? id;
  const highlight = (e: Exception) => {
    const d = daysUntil(e.expiresAt);
    return d <= 0 ? 'var(--bad-soft)' : d <= 14 ? 'var(--warn-soft)' : undefined;
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Exceptions</h1>
          <div className="muted">
            Registered in git and approved by security. The owner is warned 14 days before expiry; on expiry the finding
            re-opens and escalates to their lead. Many exceptions on one rule means the rule or golden path should change.
          </div>
        </div>
      </div>
      <Card>
        {data.length === 0 ? <p className="muted">No exceptions.</p> : (
          <table>
            <thead><tr><th>Account</th><th>Rule</th><th>Owner</th><th>Reason / compensating control</th><th>Expiry</th></tr></thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id} style={{ background: highlight(e) }}>
                  <td><Link to={`/accounts/${e.targetId}`}>{name(e.targetId)}</Link></td>
                  <td className="mono">{e.rule}</td>
                  <td className="small">{e.owner}</td>
                  <td>{e.reason}<div className="small muted">{e.compensatingControl}</div></td>
                  <td><ExpiryPill expiresAt={e.expiresAt} /><div className="small muted">{when(e.expiresAt)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
