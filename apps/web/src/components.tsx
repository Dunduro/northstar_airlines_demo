import type { ReactNode } from 'react';

export const Pill = ({ kind, children }: { kind: string; children?: ReactNode }) => (
  <span className={`pill ${kind}`}>{children ?? kind}</span>
);

export const Card = ({ title, children, action }: { title?: ReactNode; children: ReactNode; action?: ReactNode }) => (
  <section className="card">
    {(title || action) && (
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        {title && <h2 style={{ margin: 0 }}>{title}</h2>}
        {action}
      </div>
    )}
    {children}
  </section>
);

export const Loading = ({ error }: { error?: string }) =>
  error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;

export const daysUntil = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);

export function ExpiryPill({ expiresAt }: { expiresAt: string }) {
  const d = daysUntil(expiresAt);
  if (d <= 0) return <Pill kind="bad">expired {Math.abs(d)}d ago</Pill>;
  if (d <= 14) return <Pill kind="warn">expires in {d}d</Pill>;
  return <Pill kind="neutral">{d} days left</Pill>;
}

export const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** 30-day trend as a simple line; values in percent. */
export function Sparkline({ points }: { points: { day: string; percentCompliant: number }[] }) {
  if (points.length < 2) return null;
  const w = 520;
  const h = 110;
  const min = Math.min(50, ...points.map((p) => p.percentCompliant));
  const x = (i: number) => (i / (points.length - 1)) * (w - 8) + 4;
  const y = (v: number) => h - 6 - ((v - min) / (100 - min)) * (h - 12);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.percentCompliant).toFixed(1)}`).join(' ');
  const last = points[points.length - 1]!;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label={`Compliance trend, today ${last.percentCompliant}%`}>
      <line x1="0" x2={w} y1={y(100)} y2={y(100)} stroke="var(--border)" strokeDasharray="4 4" />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinejoin="round" />
      <circle cx={x(points.length - 1)} cy={y(last.percentCompliant)} r="5" fill="var(--accent)" />
    </svg>
  );
}
