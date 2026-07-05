import { EngineError } from './errors';
import { roundHalfUp } from './rounding';

/** Every numeric value in the system is tagged with a unit. Engine functions
 *  refuse to combine mismatched units instead of silently producing garbage. */
export type Unit =
  | { kind: 'money'; currency: string; scale: number }
  | { kind: 'ratio' }
  | { kind: 'percent' }
  | { kind: 'count' };

export const RATIO_UNIT: Unit = { kind: 'ratio' };
export const PERCENT_UNIT: Unit = { kind: 'percent' };
export const COUNT_UNIT: Unit = { kind: 'count' };

export function moneyUnit(currency: string, scale = 1000): Unit {
  return { kind: 'money', currency, scale };
}

export function sameUnit(a: Unit, b: Unit): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'money' && b.kind === 'money') {
    return a.currency === b.currency && a.scale === b.scale;
  }
  return true;
}

export function assertSameUnit(a: Unit, b: Unit, context: string): void {
  if (!sameUnit(a, b)) {
    throw new EngineError(`unit mismatch in ${context}: ${describeUnit(a)} vs ${describeUnit(b)}`, 'UNIT_MISMATCH', {
      a,
      b,
    });
  }
}

export function describeUnit(u: Unit): string {
  return u.kind === 'money' ? `${u.currency}×${u.scale}` : u.kind;
}

const CURRENCY_SYMBOLS: Record<string, string> = { PEN: 'S/ ', USD: 'US$ ' };

/** Human display formatting. Values are stored exact; rounding happens only here. */
export function formatValue(value: number, unit: Unit): string {
  switch (unit.kind) {
    case 'money': {
      const abs = Math.abs(value * unit.scale);
      const sign = value < 0 ? '−' : '';
      const sym = CURRENCY_SYMBOLS[unit.currency] ?? `${unit.currency} `;
      if (abs >= 1e9) return `${sign}${sym}${(abs / 1e9).toFixed(2)}bn`;
      if (abs >= 1e6) return `${sign}${sym}${(abs / 1e6).toFixed(1)}m`;
      if (abs >= 1e3) return `${sign}${sym}${(abs / 1e3).toFixed(0)}k`;
      return `${sign}${sym}${abs.toFixed(0)}`;
    }
    case 'ratio':
      return `${roundHalfUp(value, 2).toFixed(2)}×`;
    case 'percent':
      return `${roundHalfUp(value * 100, 1).toFixed(1)}%`;
    case 'count':
      return String(roundHalfUp(value, 0));
  }
}
