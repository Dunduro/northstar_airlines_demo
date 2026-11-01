import { describe, expect, it } from 'vitest';
import { heatmapTeams } from '../src/compliance.js';

describe('heatmap teams', () => {
  it('keeps the known teams in their fixed order and only those present', () => {
    expect(heatmapTeams([{ team: 'security' }, { team: 'payments' }, { team: 'cargo' }, { team: 'payments' }])).toEqual(['payments', 'cargo', 'security']);
  });

  it('never hides a team that is not in the built-in list (a new team added to the registry)', () => {
    const cells = [{ team: 'platform' }, { team: 'team-002' }, { team: 'team-001' }, { team: 'team-001' }];
    expect(heatmapTeams(cells)).toEqual(['platform', 'team-001', 'team-002']);
  });
});
