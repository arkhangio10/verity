import type { CovenantSpec, RatioKey } from './definitions';
import { thresholdForPeriod } from './definitions';
import { EngineError, last } from './errors';
import { nextQuarterLabel } from './periods';
import { olsSlope } from './volatility';

export interface DriftPoint {
  period: string;
  value: number;
}

export type DriftDirection = 'toward_breach' | 'away_from_breach' | 'flat';

export interface DriftAnalysis {
  ratio: RatioKey;
  covenantId: string;
  points: DriftPoint[];
  lookback: number;
  slopePerQuarter: number;
  direction: DriftDirection;
  projections: DriftPoint[];
  projectedBreachPeriod: string | null;
  quartersToBreach: number | null;
  thresholdAtLatest: number;
}

export interface DriftOptions {
  lookback?: number;
  horizon?: number;
  /** Slope magnitudes below this (in ratio units per quarter) count as flat. */
  flatEpsilon?: number;
}

/**
 * Drift detection: fit a linear trend to the recent covenant-ratio path and
 * project it forward. A simple, explainable model on purpose — the point is
 * early warning with visible math, not forecasting precision.
 */
export function analyzeDrift(
  points: DriftPoint[],
  spec: CovenantSpec,
  opts: DriftOptions = {},
): DriftAnalysis {
  const lookback = opts.lookback ?? 4;
  const horizon = opts.horizon ?? 4;
  const flatEps = opts.flatEpsilon ?? 0.005;
  if (points.length < 2) {
    throw new EngineError('drift analysis needs at least 2 points', 'INSUFFICIENT_HISTORY');
  }
  const recent = points.slice(-lookback);
  const slope = olsSlope(recent.map((p) => p.value));
  const latest = last(points, 'drift points');
  const thresholdAtLatest = thresholdForPeriod(spec, latest.period);

  let direction: DriftDirection = 'flat';
  if (Math.abs(slope) >= flatEps) {
    const towardBreach = spec.comparator === 'max' ? slope > 0 : slope < 0;
    direction = towardBreach ? 'toward_breach' : 'away_from_breach';
  }

  const projections: DriftPoint[] = [];
  let projectedBreachPeriod: string | null = null;
  let quartersToBreach: number | null = null;
  for (let k = 1; k <= horizon; k++) {
    const period = nextQuarterLabel(latest.period, k);
    const value = latest.value + slope * k;
    projections.push({ period, value });
    if (projectedBreachPeriod === null) {
      const threshold = thresholdForPeriod(spec, period);
      const breaches = spec.comparator === 'max' ? value > threshold : value < threshold;
      if (breaches) {
        projectedBreachPeriod = period;
        quartersToBreach = k;
      }
    }
  }

  return {
    ratio: spec.ratio,
    covenantId: spec.id,
    points,
    lookback: recent.length,
    slopePerQuarter: slope,
    direction,
    projections,
    projectedBreachPeriod,
    quartersToBreach,
    thresholdAtLatest,
  };
}
