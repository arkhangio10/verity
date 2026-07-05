import type { CitedComputation } from './citations';
import type { CovenantSpec, MetricDefinitions, RatioKey } from './definitions';
import type { Headroom } from './headroom';
import { computeHeadroom } from './headroom';
import type { ResolvedBundle } from './resolve';
import { computeAllRatios } from './ratios';

export type AtomicShock =
  | { kind: 'ebitda_pct'; pct: number }
  | { kind: 'rates_bps'; bps: number };

export type Shock = AtomicShock | { kind: 'combined'; shocks: AtomicShock[] };

export function shockLabel(shock: Shock): string {
  switch (shock.kind) {
    case 'ebitda_pct':
      return `EBITDA ${shock.pct >= 0 ? '+' : '−'}${Math.abs(shock.pct * 100).toFixed(0)}%`;
    case 'rates_bps':
      return `Rates ${shock.bps >= 0 ? '+' : '−'}${Math.abs(shock.bps).toFixed(0)} bps`;
    case 'combined':
      return shock.shocks.map(shockLabel).join(' + ');
  }
}

function scaleComp(c: CitedComputation, factor: number, note: string): CitedComputation {
  return {
    ...c,
    id: `${c.id}|stressed`,
    label: `${c.label} (stressed)`,
    value: c.value * factor,
    formula: `${c.formula} — stressed: ${note}`,
    notes: [...c.notes, note],
  };
}

function shiftComp(c: CitedComputation, delta: number, note: string): CitedComputation {
  return {
    ...c,
    id: `${c.id}|stressed`,
    label: `${c.label} (stressed)`,
    value: c.value + delta,
    formula: `${c.formula} — stressed: ${note}`,
    notes: [...c.notes, note],
  };
}

/** Apply a shock to a resolved bundle and return the stressed bundle. The
 *  original inputs stay attached, so stressed ratios remain fully cited. */
export function applyShock(b: ResolvedBundle, shock: Shock): ResolvedBundle {
  switch (shock.kind) {
    case 'ebitda_pct': {
      const note = `${shockLabel(shock)} applied to Covenant EBITDA`;
      return { ...b, ebitda: scaleComp(b.ebitda, 1 + shock.pct, note) };
    }
    case 'rates_bps': {
      const delta = (b.floatingRateDebt.value * shock.bps) / 10_000;
      const note =
        b.floatingRateDebt.value === 0
          ? `${shockLabel(shock)}: no effect — floating-rate share not disclosed, debt assumed fixed`
          : `${shockLabel(shock)} applied to floating-rate debt (annualized)`;
      return {
        ...b,
        cashInterest: shiftComp(b.cashInterest, delta, note),
        interestExpense: shiftComp(b.interestExpense, delta, note),
      };
    }
    case 'combined':
      return shock.shocks.reduce<ResolvedBundle>((acc, s) => applyShock(acc, s), b);
  }
}

export interface StressScenario {
  shock: Shock;
  label: string;
  ratios: Record<RatioKey, CitedComputation>;
  headrooms: Headroom[];
  /** Covenants that would trip under this scenario. */
  breaches: string[];
}

export const STANDARD_SHOCKS: Shock[] = [
  { kind: 'ebitda_pct', pct: -0.1 },
  { kind: 'ebitda_pct', pct: -0.2 },
  { kind: 'rates_bps', bps: 200 },
  { kind: 'combined', shocks: [{ kind: 'ebitda_pct', pct: -0.1 }, { kind: 'rates_bps', bps: 200 }] },
];

/** Recompute every ratio under each shock and re-test the covenants. */
export function runStress(
  bundle: ResolvedBundle,
  defs: MetricDefinitions,
  covenants: CovenantSpec[],
  shocks: Shock[] = STANDARD_SHOCKS,
  warnBelowPct?: number,
): StressScenario[] {
  return shocks.map((shock) => {
    const stressed = applyShock(bundle, shock);
    const ratios = computeAllRatios(stressed, defs);
    const headrooms = covenants.map((spec) => {
      const ratio = ratios[spec.ratio];
      return computeHeadroom(ratio.value, spec, bundle.periodLabel, warnBelowPct);
    });
    return {
      shock,
      label: shockLabel(shock),
      ratios,
      headrooms,
      breaches: headrooms.filter((h) => h.status === 'breach').map((h) => h.covenantId),
    };
  });
}
