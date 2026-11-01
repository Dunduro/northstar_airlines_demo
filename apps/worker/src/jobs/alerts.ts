/** route-alert and send-digest: deliver (or queue) alerts, deduplicated via the alerts table. */
import type { Db } from '@northstar/db';
import { planAlerts, type AlertCandidate } from '../domain/alert-routing.js';
import { openTicket, sendTeams } from '../outbound.js';

export const DEDUPE_WINDOW_HOURS = 24;

export async function routeAlerts(db: Db, candidates: AlertCandidate[]): Promise<void> {
  const keys = candidates.map((c) => c.key);
  const { rows } = await db.query(
    `SELECT DISTINCT dedupe_key FROM alerts WHERE dedupe_key = ANY($1::text[]) AND last_at > now() - make_interval(hours => $2)`,
    [keys, DEDUPE_WINDOW_HOURS],
  );
  const { deliveries, suppressed } = planAlerts(candidates, new Set(rows.map((r) => r.dedupe_key)));

  for (const s of suppressed) {
    await db.query(
      `UPDATE alerts SET count = count + 1, last_at = now()
       WHERE id = (SELECT id FROM alerts WHERE dedupe_key = $1 ORDER BY last_at DESC LIMIT 1)`,
      [s.key],
    );
  }

  for (const d of deliveries) {
    let ticket: string | null = null;
    if (d.delivery === 'now') {
      if (d.ticket) ticket = await openTicket({ title: d.title, team: d.team, severity: d.severity, link: d.link });
      const text = d.members.length > 1
        ? `${d.members.length} accounts: ${d.members.map((m) => m.targetName).join(', ')}`
        : `Owner: ${d.team}${ticket ? ` · ticket ${ticket}` : ''}`;
      for (const channel of d.channels) {
        await sendTeams(channel.replace(/^teams:/, ''), { title: d.title, severity: d.severity, text, link: d.link });
      }
    }
    const status = d.delivery === 'now' ? 'sent' : 'digest_pending';
    await db.query(
      `INSERT INTO alerts (dedupe_key, team, severity, delivery, status, title, link, ticket) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [d.key, d.team, d.severity, d.delivery, status, d.title, d.link, ticket],
    );
    // Grouped members are recorded too, so a re-run of the same change does not page each team later.
    if (d.members.length > 1) {
      for (const m of d.members) {
        await db.query(
          `INSERT INTO alerts (dedupe_key, team, severity, delivery, status, title, link) VALUES ($1,$2,$3,$4,'grouped',$5,$6)`,
          [m.key, m.team, m.severity, d.delivery, m.title, m.link],
        );
      }
    }
  }
}

/** Daily digest: low-severity items (e.g. drift in Dev) as ONE message per team, no page. */
export async function sendDigest(db: Db): Promise<void> {
  const { rows } = await db.query(
    `SELECT team, array_agg(title ORDER BY first_at) AS titles FROM alerts WHERE status = 'digest_pending' GROUP BY team`,
  );
  for (const r of rows) {
    await sendTeams(r.team, {
      title: `Daily digest for ${r.team}: ${r.titles.length} low-priority item${r.titles.length === 1 ? '' : 's'}`,
      severity: 'low',
      text: r.titles.slice(0, 10).join('\n'),
      link: '',
    });
    await db.query(`UPDATE alerts SET status = 'digest_sent' WHERE status = 'digest_pending' AND team = $1`, [r.team]);
  }
}
