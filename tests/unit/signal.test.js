import { describe, it, expect } from 'vitest';
import { hourlyCounts } from '../../js/signal.js';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const at = hoursAgo => ({ date: new Date(NOW - hoursAgo * HOUR).toISOString() });

describe('hourlyCounts', () => {
  it('returns 24 buckets, oldest first, newest last', () => {
    const counts = hourlyCounts([at(0.2), at(0.5), at(23.5)], NOW);
    expect(counts).toHaveLength(24);
    expect(counts[23]).toBe(2);
    expect(counts[0]).toBe(1);
  });

  it('ignores future, too-old and undated stories', () => {
    const counts = hourlyCounts([at(-1), at(24), at(30), { date: 'nope' }, {}, null], NOW);
    expect(counts.reduce((s, n) => s + n, 0)).toBe(0);
  });
});
