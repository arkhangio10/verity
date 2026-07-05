import { describe, expect, it } from 'vitest';
import { computeHeadroom, thresholdForPeriod, type CovenantSpec } from '@covenant/core';

const leverageSpec: CovenantSpec = {
  id: 'lev',
  name: 'Maximum Net Leverage',
  ratio: 'leverage',
  comparator: 'max',
  threshold: 3.5,
  testBasis: 'ltm',
  frequency: 'quarterly',
};

const dscrSpec: CovenantSpec = {
  id: 'dscr',
  name: 'Minimum DSCR',
  ratio: 'dscr',
  comparator: 'min',
  threshold: 1.25,
  testBasis: 'ltm',
  frequency: 'quarterly',
};

describe('headroom math', () => {
  it('max-type: cushion = threshold − actual; pct = cushion ÷ threshold', () => {
    const h = computeHeadroom(3.38, leverageSpec, '2026-Q1');
    expect(h.cushion).toBeCloseTo(0.12, 10);
    expect(h.headroomPct).toBeCloseTo(0.12 / 3.5, 10);
    expect(h.status).toBe('tight'); // 3.43% < 10% warning line
  });

  it('min-type: cushion = actual − threshold', () => {
    const h = computeHeadroom(1.6, dscrSpec, '2026-Q1');
    expect(h.cushion).toBeCloseTo(0.35, 10);
    expect(h.headroomPct).toBeCloseTo(0.28, 10);
    expect(h.status).toBe('compliant');
  });

  it('flags breaches', () => {
    expect(computeHeadroom(3.62, leverageSpec, '2026-Q1').status).toBe('breach');
    expect(computeHeadroom(1.19, dscrSpec, '2026-Q1').status).toBe('breach');
  });

  it('honors step-downs when computing the effective threshold', () => {
    const stepped: CovenantSpec = {
      ...leverageSpec,
      stepDowns: [
        { fromPeriod: '2026-Q3', threshold: 3.25 },
        { fromPeriod: '2027-Q3', threshold: 3.0 },
      ],
    };
    expect(thresholdForPeriod(stepped, '2026-Q2')).toBe(3.5);
    expect(thresholdForPeriod(stepped, '2026-Q3')).toBe(3.25);
    expect(thresholdForPeriod(stepped, '2028-Q1')).toBe(3.0);
    const h = computeHeadroom(3.3, stepped, '2026-Q3');
    expect(h.threshold).toBe(3.25);
    expect(h.status).toBe('breach');
  });

  it('respects a custom warning line', () => {
    const h = computeHeadroom(3.2, leverageSpec, '2026-Q1', 0.02);
    expect(h.status).toBe('compliant');
  });
});
