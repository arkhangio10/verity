import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  formatValue,
  moneyUnit,
  nextQuarterLabel,
  PERCENT_UNIT,
  quarterIndex,
  RATIO_UNIT,
  roundHalfUp,
  roundToStep,
  clamp,
  EngineError,
} from '@covenant/core';

describe('rounding', () => {
  it('rounds half away from zero and survives float artifacts', () => {
    expect(roundHalfUp(2.675, 2)).toBe(2.68);
    expect(roundHalfUp(-2.5, 0)).toBe(-3);
    expect(roundHalfUp(1.005, 2)).toBe(1.01);
  });

  it('rounds to market steps', () => {
    expect(roundToStep(3.3, 0.25, 'up')).toBe(3.5);
    expect(roundToStep(4.08, 0.25, 'up')).toBe(4.25);
    expect(roundToStep(1.14, 0.05, 'down')).toBe(1.1);
    expect(roundToStep(3.875, 0.25, 'nearest')).toBe(4.0);
    expect(() => roundToStep(1, 0)).toThrowError(EngineError);
  });

  it('clamp validates its bounds', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(() => clamp(1, 3, 0)).toThrowError(EngineError);
  });
});

describe('periods', () => {
  it('indexes and advances quarters, including year wrap', () => {
    expect(quarterIndex('2026-Q1')).toBe(2026 * 4);
    expect(nextQuarterLabel('2025-Q4')).toBe('2026-Q1');
    expect(nextQuarterLabel('2026-Q1', 2)).toBe('2026-Q3');
    expect(() => quarterIndex('2026-T1')).toThrowError(EngineError);
  });

  it('daysBetween', () => {
    expect(daysBetween('2026-05-15', '2026-06-30')).toBe(46);
  });
});

describe('unit formatting', () => {
  it('formats money at statement scale', () => {
    expect(formatValue(45_000, moneyUnit('PEN', 1000))).toBe('S/ 45.0m');
    expect(formatValue(850, moneyUnit('PEN', 1000))).toBe('S/ 850k');
    expect(formatValue(-1_500_000, moneyUnit('USD', 1000))).toBe('−US$ 1.50bn');
  });

  it('formats ratios and percents', () => {
    expect(formatValue(3.3775, RATIO_UNIT)).toBe('3.38×');
    expect(formatValue(0.0343, PERCENT_UNIT)).toBe('3.4%');
  });
});
