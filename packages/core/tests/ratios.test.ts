import { describe, expect, it } from 'vitest';
import {
  collectSources,
  computeAllRatios,
  computeCurrentRatio,
  computeDscr,
  computeFccr,
  computeIcr,
  computeLeverage,
  EngineError,
  resolveBundle,
} from '@covenant/core';
import { standardWindow, testDefinitions } from './helpers';

// LTM totals implied by standardWindow(): operating profit 75, D&A 25,
// stock comp 4, cash taxes 10, cash interest 20, accrual interest 20,
// scheduled principal 25, lease principal 5, capex 40 (10 financed),
// distributions 20. Latest balance: total debt 350, cash 50, net debt 300.

describe('covenant ratios with known inputs', () => {
  const defs = testDefinitions();
  const bundle = resolveBundle(standardWindow(), '2026-Q1', defs);

  it('resolves Covenant EBITDA with add-backs (no one-time items): 75 + 25 + 4 = 104', () => {
    expect(bundle.ebitda.value).toBeCloseTo(104, 10);
  });

  it('DSCR = (104 − 10) ÷ (20 + 25 + 5) = 1.88', () => {
    const dscr = computeDscr(bundle, defs);
    expect(dscr.value).toBeCloseTo(94 / 50, 10);
  });

  it('DSCR excludes lease principal when the definition says so: 94 ÷ 45', () => {
    const noLease = {
      ...defs,
      debtService: { ...defs.debtService, includeLeasePrincipal: false },
    };
    const b = resolveBundle(standardWindow(), '2026-Q1', noLease);
    expect(computeDscr(b, noLease).value).toBeCloseTo(94 / 45, 10);
  });

  it('Leverage = Net Debt 300 ÷ EBITDA 104', () => {
    expect(computeLeverage(bundle, defs).value).toBeCloseTo(300 / 104, 10);
  });

  it('Leverage excludes IFRS 16 leases when the definition says so', () => {
    const noLeases = { ...defs, debt: { ...defs.debt, includeLeaseLiabilities: false } };
    const b = resolveBundle(standardWindow(), '2026-Q1', noLeases);
    // total debt drops by 20 (8 current + 12 non-current leases)
    expect(b.totalDebt.value).toBeCloseTo(330, 10);
    expect(computeLeverage(b, noLeases).value).toBeCloseTo(280 / 104, 10);
  });

  it('ICR = EBIT 75 ÷ interest 20 = 3.75', () => {
    expect(computeIcr(bundle, defs).value).toBeCloseTo(3.75, 10);
  });

  it('Current ratio = 200 ÷ 160 = 1.25', () => {
    expect(computeCurrentRatio(bundle, defs).value).toBeCloseTo(1.25, 10);
  });

  it('FCCR = (104 − 30 − 10 − 20) ÷ (20 + 25 + 5) = 0.88', () => {
    expect(computeFccr(bundle, defs).value).toBeCloseTo(44 / 50, 10);
  });

  it('every ratio carries citations back to the source filings', () => {
    const ratios = computeAllRatios(bundle, defs);
    for (const comp of Object.values(ratios)) {
      const docs = new Set(collectSources(comp).map((s) => s.docId));
      expect(docs.size).toBeGreaterThan(0);
      expect([...docs].some((d) => d.startsWith('filing-'))).toBe(true);
    }
  });

  it('throws a typed error on division by zero', () => {
    const zeroInterest = standardWindow({ interestExpense: 0 });
    const b = resolveBundle(zeroInterest, '2026-Q1', defs);
    expect(() => computeIcr(b, defs)).toThrowError(EngineError);
    try {
      computeIcr(b, defs);
    } catch (err) {
      expect((err as EngineError).code).toBe('DIV_BY_ZERO');
    }
  });
});
