import { EngineError } from './errors';

/** Round half away from zero (financial convention), guarding float artifacts
 *  such as 2.675 * 100 === 267.49999999999997. */
export function roundHalfUp(x: number, dp = 2): number {
  if (!Number.isFinite(x)) {
    throw new EngineError(`cannot round non-finite value ${x}`, 'BAD_ARGUMENT');
  }
  const f = 10 ** dp;
  const scaled = Number((Math.abs(x) * f).toPrecision(12));
  return ((Math.sign(x) || 1) * Math.round(scaled)) / f;
}

/** Round to a market-convention step, e.g. leverage thresholds move in 0.25×
 *  steps and coverage floors in 0.05× steps. */
export function roundToStep(
  x: number,
  step: number,
  mode: 'up' | 'down' | 'nearest' = 'nearest',
): number {
  if (!(step > 0)) throw new EngineError(`step must be > 0, got ${step}`, 'BAD_ARGUMENT');
  const q = Number((x / step).toPrecision(12));
  const n = mode === 'up' ? Math.ceil(q - 1e-9) : mode === 'down' ? Math.floor(q + 1e-9) : Math.round(q);
  return roundHalfUp(n * step, 6);
}

export function clamp(x: number, min: number, max: number): number {
  if (min > max) throw new EngineError(`clamp bounds inverted: [${min}, ${max}]`, 'BAD_ARGUMENT');
  return Math.min(max, Math.max(min, x));
}
