import { describe, expect, it } from 'vitest';
import { analyzeSeries, EngineError, olsSlope } from '@covenant/core';

describe('volatility analysis', () => {
  it('computes mean, sample stdev, CoV and trend for a known series', () => {
    const stats = analyzeSeries([10, 12, 8, 14]);
    expect(stats.n).toBe(4);
    expect(stats.mean).toBeCloseTo(11, 10);
    expect(stats.stdevSample).toBeCloseTo(Math.sqrt(20 / 3), 10);
    expect(stats.coefficientOfVariation).toBeCloseTo(Math.sqrt(20 / 3) / 11, 10);
    expect(stats.min).toBe(8);
    expect(stats.max).toBe(14);
    expect(stats.latest).toBe(14);
    expect(stats.trendSlopePerPeriod).toBeCloseTo(0.8, 10);
  });

  it('a constant series has zero volatility and zero slope', () => {
    const stats = analyzeSeries([5, 5, 5, 5, 5]);
    expect(stats.stdevSample).toBe(0);
    expect(stats.coefficientOfVariation).toBe(0);
    expect(stats.trendSlopePerPeriod).toBe(0);
  });

  it('rejects series that are too short', () => {
    expect(() => analyzeSeries([1, 2, 3])).toThrowError(EngineError);
  });

  it('rejects zero-mean series (CoV undefined)', () => {
    expect(() => analyzeSeries([-1, 1, -1, 1])).toThrowError(/zero-mean/);
  });

  it('olsSlope matches hand computation', () => {
    expect(olsSlope([2.81, 2.86, 3.04, 3.26])).toBeCloseTo(0.153, 10);
  });
});
