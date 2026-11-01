/** snapshot-compliance: store today's compliance per environment x team for the 30-day trend. */
import type { Db } from '@northstar/db';

export const COMPLIANCE_BY_CELL_SQL = `
  SELECT t.environment, t.team, count(*)::int AS total,
         count(*) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM findings f WHERE f.target_id = t.id AND f.status = 'open' AND f.severity IN ('high','critical')
         ))::int AS compliant
  FROM targets t GROUP BY t.environment, t.team`;

export async function snapshotCompliance(db: Db): Promise<void> {
  await db.query(
    `INSERT INTO compliance_snapshots (day, environment, team, total, compliant)
     SELECT current_date, environment, team, total, compliant FROM (${COMPLIANCE_BY_CELL_SQL}) cells
     ON CONFLICT (day, environment, team) DO UPDATE SET total = EXCLUDED.total, compliant = EXCLUDED.compliant`,
  );
}
