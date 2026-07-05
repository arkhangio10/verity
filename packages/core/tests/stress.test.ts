import { describe, expect, it } from 'vitest';
import {
  applyShock,
  computeDscr,
  computeLeverage,
  resolveBundle,
  runStress,
  shockLabel,
  type CovenantSpec,
} from '@covenant/core';
import { standardWindow, testDefinitions } from './helpers';

const defs = testDefinitions();
const covenant: CovenantSpec = {
  id: 'lev',
  name: 'Maximum Net Leverage',
  ratio: 'leverage',
  comparator: 'max',
  threshold: 3.0,
  testBasis: 'ltm',
  frequency: 'quarterly',
};

describe('stress testing', () => {
  const bundle = resolveBundle(standardWindow(), '2026-Q1', defs);
  // baseline: EBITDA 104, net debt 300 → leverage 2.8846

  it('EBITDA −20% recomputes leverage: 300 ÷ 83.2 = 3.6058 and trips the covenant', () => {
    const scenarios = runStress(bundle, defs, [covenant], [{ kind: 'ebitda_pct', pct: -0.2 }]);
    const s = scenarios[0]!;
    expect(s.ratios.leverage.value).toBeCloseTo(300 / 83.2, 10);
    expect(s.breaches).toContain('lev');
    const headroom = s.headrooms[0]!;
    expect(headroom.status).toBe('breach');
    expect(headroom.cushion).toBeLessThan(0);
  });

  it('EBITDA −10% stays compliant against a 3.50× cap', () => {
    const loose = { ...covenant, threshold: 3.5 };
    const scenarios = runStress(bundle, defs, [loose], [{ kind: 'ebitda_pct', pct: -0.1 }]);
    expect(scenarios[0]!.ratios.leverage.value).toBeCloseTo(300 / 93.6, 10);
    expect(scenarios[0]!.breaches).toEqual([]);
  });

  it('rates +200 bps raises interest via the floating share: DSCR 94 ÷ 53.5', () => {
    // floating debt = 350 × 0.5 = 175 → +200 bps = +3.5 interest
    const stressed = applyShock(bundle, { kind: 'rates_bps', bps: 200 });
    expect(stressed.cashInterest.value).toBeCloseTo(23.5, 10);
    expect(computeDscr(stressed, defs).value).toBeCloseTo(94 / 53.5, 10);
    // leverage is untouched by a pure rate shock
    expect(computeLeverage(stressed, defs).value).toBeCloseTo(300 / 104, 10);
  });

  it('rate shock is a disclosed no-op when the floating share is unknown', () => {
    const noShare = resolveBundle(standardWindow({ floatingShare: undefined }), '2026-Q1', defs);
    const stressed = applyShock(noShare, { kind: 'rates_bps', bps: 200 });
    expect(stressed.cashInterest.value).toBeCloseTo(noShare.cashInterest.value, 10);
    expect(stressed.cashInterest.notes.join(' ')).toMatch(/assumed fixed/);
  });

  it('combined shocks compose', () => {
    const stressed = applyShock(bundle, {
      kind: 'combined',
      shocks: [{ kind: 'ebitda_pct', pct: -0.1 }, { kind: 'rates_bps', bps: 200 }],
    });
    expect(stressed.ebitda.value).toBeCloseTo(93.6, 10);
    expect(stressed.cashInterest.value).toBeCloseTo(23.5, 10);
  });

  it('stressed computations keep their citations and gain explanatory notes', () => {
    const stressed = applyShock(bundle, { kind: 'ebitda_pct', pct: -0.2 });
    expect(stressed.ebitda.inputs.length).toBe(bundle.ebitda.inputs.length);
    expect(stressed.ebitda.notes.some((n) => n.includes('EBITDA −20%'))).toBe(true);
  });

  it('labels shocks for display', () => {
    expect(shockLabel({ kind: 'ebitda_pct', pct: -0.2 })).toBe('EBITDA −20%');
    expect(shockLabel({ kind: 'rates_bps', bps: 200 })).toBe('Rates +200 bps');
    expect(
      shockLabel({ kind: 'combined', shocks: [{ kind: 'ebitda_pct', pct: -0.1 }, { kind: 'rates_bps', bps: 200 }] }),
    ).toBe('EBITDA −10% + Rates +200 bps');
  });
});
