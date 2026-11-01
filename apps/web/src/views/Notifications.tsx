import { useState } from 'react';
import { useApi } from '../api';
import { Pill, when } from '../components';

interface Notification {
  id: number;
  at: string;
  kind: 'teams' | 'servicenow' | 'github';
  channel: string;
  title: string;
  severity?: string;
  text?: string;
  link?: string;
}

const KIND: Record<Notification['kind'], string> = { teams: 'Teams', servicenow: 'ServiceNow', github: 'GitHub dispatch' };

/** What the outside world received from the platform (served by the mock receivers). */
export function NotificationsPanel() {
  const { data, error } = useApi<Notification[]>('/mock/notifications', 1500);
  const [showDispatches, setShowDispatches] = useState(false);
  const dispatches = data?.filter((n) => n.kind === 'github').length ?? 0;
  const shown = data?.filter((n) => showDispatches || n.kind !== 'github');
  return (
    <aside className="panel" aria-label="Notifications">
      <h2>Notifications</h2>
      <p className="small muted" style={{ marginTop: '-0.5rem' }}>
        Received by the mock Teams, ServiceNow and GitHub. In real life people see these where they already work.
      </p>
      {error && <p className="error small">Mock receivers unreachable</p>}
      <label className="small" style={{ fontWeight: 400, display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={showDispatches} onChange={(e) => setShowDispatches(e.target.checked)} />
        Show GitHub workflow dispatches ({dispatches})
      </label>
      {shown?.length === 0 && <p className="muted small">Nothing yet.</p>}
      {shown?.map((n) => (
        <div key={n.id} className={`notif ${n.kind}`}>
          <div className="meta">
            <span>
              {KIND[n.kind]} · <strong>{n.channel}</strong>
            </span>
            <span>{when(n.at)}</span>
          </div>
          <div className="title">
            {n.severity && <Pill kind={n.severity} />} {n.title}
          </div>
          {n.text && <div className="text">{n.text}</div>}
          {n.link && n.link.startsWith('http') && (
            <div className="small">
              <a href={n.link.replace(/^http:\/\/[^/]+(?=\/(accounts|rollouts))/, '')} target={n.link.includes('github.com') ? '_blank' : undefined} rel="noreferrer">
                open →
              </a>
            </div>
          )}
        </div>
      ))}
    </aside>
  );
}
