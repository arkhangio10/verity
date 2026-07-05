import { describe, expect, it } from 'vitest';
import { proposeCovenantPackage, type ProposalInputs } from '@covenant/core';

const baseInputs: ProposalInputs = {
  asOfPeriod: '2026-Q1',
  current: { leverage: 3.0, dscr: 1.6, icr: 2.4, current_ratio: 1.4, fccr: 1.3 },
  worstStressed: { leverage: 3.9, dscr: 1.2, icr: 1.9, current_ratio: 1.3, fccr: 1.05 },
  ebitdaQuarterlyCov: 0.15,
  hasScheduledAmortization: true,
  distributionsShareOfEbitda: 0.25,
};

describe('deterministic covenant-package proposal policy', () => {
  const pkg = proposeCovenantPackage(baseInputs);
  const byId = Object.fromEntries(pkg.covenants.map((c) => [c.id, c]));

  it('leverage cap survives the worst stress, plus a volatility cushion: 4.25', () => {
    const lev = byId['proposed-leverage']!;
    // max(3.0×1.10, 3.9) = 3.9 → round up to 4.00 → +0.25 high-vol cushion = 4.25
    expect(lev.threshold).toBeCloseTo(4.25, 10);
    expect(lev.comparator).toBe('max');
    expect(lev.rationaleTags).toContain('volatility_cushion');
  });

  it('leverage steps down to the landing level over eight quarters', () => {
    const lev = byId['proposed-leverage']!;
    expect(lev.stepDowns).toEqual([
      { fromPeriod: '2027-Q1', threshold: 4.0 },
      { fromPeriod: '2028-Q1', threshold: 3.5 },
    ]);
  });

  it('DSCR floor derives from the stressed value with a 5% margin: 1.10', () => {
    const dscr = byId['proposed-dscr']!;
    // 1.2 × 0.95 = 1.14 → round down to 1.10, clamped to policy floor 1.10
    expect(dscr.threshold).toBeCloseTo(1.1, 10);
    expect(dscr.comparator).toBe('min');
  });

  it('liquidity floor: min(1.4×0.85, 1.3) = 1.19 → 1.15', () => {
    expect(byId['proposed-current']!.threshold).toBeCloseTo(1.15, 10);
  });

  it('FCCR included because distributions are material, floored at 1.00', () => {
    const fccr = byId['proposed-fccr'];
    expect(fccr).toBeDefined();
    // 1.05 × 0.9 = 0.945 → round down 0.90 → clamped to 1.00
    expect(fccr!.threshold).toBeCloseTo(1.0, 10);
    expect(pkg.notes.join(' ')).toMatch(/restricted-payments/);
  });

  it('switches DSCR → ICR when there is no scheduled amortization', () => {
    const pkg2 = proposeCovenantPackage({ ...baseInputs, hasScheduledAmortization: false });
    const ids = pkg2.covenants.map((c) => c.id);
    expect(ids).toContain('proposed-icr');
    expect(ids).not.toContain('proposed-dscr');
    // 1.9 × 0.9 = 1.71 → round down to 0.25 step = 1.50
    expect(pkg2.covenants.find((c) => c.id === 'proposed-icr')!.threshold).toBeCloseTo(1.5, 10);
  });

  it('drops FCCR when distributions are immaterial', () => {
    const pkg2 = proposeCovenantPackage({ ...baseInputs, distributionsShareOfEbitda: 0.02 });
    expect(pkg2.covenants.map((c) => c.id)).not.toContain('proposed-fccr');
  });

  it('no volatility cushion when EBITDA is steady', () => {
    const pkg2 = proposeCovenantPackage({ ...baseInputs, ebitdaQuarterlyCov: 0.05 });
    // max(3.3, 3.9) = 3.9 → 4.00, no cushion
    expect(pkg2.covenants.find((c) => c.id === 'proposed-leverage')!.threshold).toBeCloseTo(4.0, 10);
  });

  it('every proposed covenant records the inputs it was derived from', () => {
    for (const c of pkg.covenants) {
      expect(Number.isFinite(c.derivedFrom.current)).toBe(true);
      expect(Number.isFinite(c.derivedFrom.worstStressed)).toBe(true);
    }
  });
});
