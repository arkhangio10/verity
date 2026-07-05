import { describe, expect, it } from 'vitest';
import { analyzeDrift, type CovenantSpec } from '@covenant/core';

const maxSpec: CovenantSpec = {
  id: 'lev',
  name: 'Maximum Net Leverage',
  ratio: 'leverage',
  comparator: 'max',
  threshold: 3.5,
  testBasis: 'ltm',
  frequency: 'quarterly',
};

describe('drift detection and breach projection', () => {
  it('projects a breach from a rising leverage path', () => {
    const points = [
      { period: '2025-Q2', value: 2.81 },
      { period: '2025-Q3', value: 2.86 },
      { period: '2025-Q4', value: 3.04 },
      { period: '2026-Q1', value: 3.26 },
    ];
    const drift = analyzeDrift(points, maxSpec);
    expect(drift.slopePerQuarter).toBeCloseTo(0.153, 10);
    expect(drift.direction).toBe('toward_breach');
    // projections: 3.413 (2026-Q2), 3.566 (2026-Q3) → crosses 3.50 in Q3
    expect(drift.projections[0]!.value).toBeCloseTo(3.413, 3);
    expect(drift.projectedBreachPeriod).toBe('2026-Q3');
    expect(drift.quartersToBreach).toBe(2);
  });

  it('an improving path is away_from_breach with no projected breach', () => {
    const points = [
      { period: '2025-Q2', value: 3.2 },
      { period: '2025-Q3', value: 3.1 },
      { period: '2025-Q4', value: 2.95 },
      { period: '2026-Q1', value: 2.8 },
    ];
    const drift = analyzeDrift(points, maxSpec);
    expect(drift.direction).toBe('away_from_breach');
    expect(drift.projectedBreachPeriod).toBeNull();
  });

  it('min-type covenants: falling coverage drifts toward breach', () => {
    const dscrSpec: CovenantSpec = { ...maxSpec, id: 'dscr', ratio: 'dscr', comparator: 'min', threshold: 1.25 };
    const points = [
      { period: '2025-Q2', value: 1.6 },
      { period: '2025-Q3', value: 1.5 },
      { period: '2025-Q4', value: 1.42 },
      { period: '2026-Q1', value: 1.33 },
    ];
    const drift = analyzeDrift(points, dscrSpec);
    expect(drift.direction).toBe('toward_breach');
    expect(drift.projectedBreachPeriod).toBe('2026-Q2'); // 1.33 − 0.0890 = 1.241 < 1.25
  });

  it('near-zero slopes count as flat', () => {
    const points = [
      { period: '2025-Q2', value: 3.0 },
      { period: '2025-Q3', value: 3.001 },
      { period: '2025-Q4', value: 2.999 },
      { period: '2026-Q1', value: 3.0 },
    ];
    expect(analyzeDrift(points, maxSpec).direction).toBe('flat');
  });

  it('projection respects step-downs (breach can come from the threshold moving)', () => {
    const stepped: CovenantSpec = {
      ...maxSpec,
      stepDowns: [{ fromPeriod: '2026-Q2', threshold: 3.25 }],
    };
    const points = [
      { period: '2025-Q2', value: 3.26 },
      { period: '2025-Q3', value: 3.28 },
      { period: '2025-Q4', value: 3.3 },
      { period: '2026-Q1', value: 3.32 },
    ];
    const drift = analyzeDrift(points, stepped);
    // slope 0.02/quarter → 3.34 in 2026-Q2, over the stepped-down 3.25 cap
    expect(drift.projectedBreachPeriod).toBe('2026-Q2');
  });
});
