import type { MyAccess } from '@northstar/shared';
import { useApi } from '../api';
import { Card, Loading, Pill } from '../components';

/** Show and link, never broker: the launch link goes to IAM Identity Center, which signs in with Entra. */
export function AccessView() {
  const { data, error } = useApi<MyAccess>('/v1/me/access', 5000);
  if (!data) return <Loading error={error} />;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>My access</h1>
          <div className="muted">
            {data.person.name} · team {data.person.team} · app roles: {data.appRoles.join(', ')}
          </div>
        </div>
      </div>
      <div className="banner info">{data.note}</div>
      <Card>
        {data.accounts.length === 0 ? <p className="muted">No AWS access.</p> : (
          <table>
            <thead><tr><th>Account</th><th>Environment</th><th>Permission set</th><th></th></tr></thead>
            <tbody>
              {data.accounts.map((a) => (
                <tr key={a.targetId}>
                  <td>{a.name}<div className="small mono muted">{a.targetId}</div></td>
                  <td>{a.environment}</td>
                  <td><Pill kind={a.permissionSet === 'ReadOnly' || a.permissionSet === 'SecurityAudit' ? 'neutral' : 'ok'}>{a.permissionSet}</Pill></td>
                  <td><a className="button secondary" href={a.launchUrl} target="_blank" rel="noreferrer">Open in AWS ↗</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
