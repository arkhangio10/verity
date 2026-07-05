import { EngineError, last } from './errors';

export interface VolatilityStats {
  n: number;
  mean: number;
  /** Sample standard deviation (n − 1 denominator). */
  stdevSample: number;
  /** stdev ÷ |mean| — the primary variability measure used for cushions. */
  coefficientOfVariation: number;
  min: number;
  max: number;
  latest: number;
  /** OLS slope per period: positive = rising trend. */
  trendSlopePerPeriod: number;
}

export const MIN_SERIES_LENGTH = 4;

/** Ordinary least squares slope of values against their index. */
export function olsSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) throw new EngineError('need at least 2 points for a trend', 'INSUFFICIENT_HISTORY');
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const y = values[i];
    if (y === undefined) continue;
    num += (i - xMean) * (y - yMean);
    den += (i - xMean) ** 2;
  }
  if (den === 0) throw new EngineError('degenerate trend regression', 'BAD_ARGUMENT');
  return num / den;
}

export function analyzeSeries(values: number[]): VolatilityStats {
  if (values.length < MIN_SERIES_LENGTH) {
    throw new EngineError(
      `volatility needs ≥ ${MIN_SERIES_LENGTH} observations, got ${values.length}`,
      'INSUFFICIENT_HISTORY',
    );
  }
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1);
  const stdevSample = Math.sqrt(variance);
  if (Math.abs(mean) < 1e-9) {
    throw new EngineError('coefficient of variation undefined for zero-mean series', 'DIV_BY_ZERO');
  }
  return {
    n,
    mean,
    stdevSample,
    coefficientOfVariation: stdevSample / Math.abs(mean),
    min: Math.min(...values),
    max: Math.max(...values),
    latest: last(values, 'series'),
    trendSlopePerPeriod: olsSlope(values),
  };
}
