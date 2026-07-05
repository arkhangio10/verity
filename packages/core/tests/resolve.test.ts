import { describe, expect, it } from 'vitest';
import {
  defaultDefinitions,
  EngineError,
  latestQuarterOnOrBefore,
  ltmWindow,
  resolveBundle,
  resolveBundleSeries,
} from '@covenant/core';
import { mkQuarter, standardWindow, testDefinitions } from './helpers';

describe('resolver: definitions drive the numbers', () => {
  it('applies the one-time add-back cap and records it in the notes', () => {
    const quarters = standardWindow();
    const q4 = quarters[3]!;
    quarters[3] = { ...q4, income: { ...q4.income, oneTimeItems: [
      { kind: 'value', label: 'Restructuring', value: 8, unit: { kind: 'money', currency: 'PEN', scale: 1000 },
        period: '2026-Q1', source: { docId: 'filing-2026-Q1', sectionId: 'notas', locator: 'restructuring' } },
    ] } };
    const bundle = resolveBundle(quarters, '2026-Q1', testDefinitions());
    // 75 + 25 + 4 (stock comp) + min(8, cap 5) = 109
    expect(bundle.ebitda.value).toBeCloseTo(109, 10);
    const capped = bundle.ebitda.inputs.find(
      (i) => i.kind === 'computation' && i.id.startsWith('ebitda.addback.one-time'),
    );
    expect(capped?.kind === 'computation' && capped.notes.some((n) => n.includes('capped'))).toBe(true);
  });

  it('contract definitions override the standard template (different EBITDA)', () => {
    const quarters = standardWindow();
    const contract = resolveBundle(quarters, '2026-Q1', testDefinitions());
    const template = resolveBundle(quarters, '2026-Q1', defaultDefinitions());
    // both add back stock comp here, but the template excludes one-time items;
    // with a one-time item present the two diverge.
    quarters[3] = {
      ...quarters[3]!,
      income: {
        ...quarters[3]!.income,
        oneTimeItems: [contractOneTime()],
      },
    };
    const contract2 = resolveBundle(quarters, '2026-Q1', testDefinitions());
    const template2 = resolveBundle(quarters, '2026-Q1', defaultDefinitions());
    expect(contract2.ebitda.value).toBeGreaterThan(template2.ebitda.value);
    expect(contract.ebitda.value).toBeCloseTo(template.ebitda.value, 10);
  });

  it('missing required input raises MISSING_INPUT with the field path', () => {
    const quarters = standardWindow();
    quarters[1] = { ...quarters[1]!, income: { ...quarters[1]!.income, operatingProfit: undefined } };
    try {
      resolveBundle(quarters, '2026-Q1', testDefinitions());
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(EngineError);
      expect((err as EngineError).code).toBe('MISSING_INPUT');
      expect((err as EngineError).message).toContain('income.operatingProfit');
    }
  });

  it('missing optional inputs default to zero and are reported for confidence', () => {
    const quarters = standardWindow({ leasePrincipal: undefined, distributions: undefined });
    const bundle = resolveBundle(quarters, '2026-Q1', testDefinitions());
    expect(bundle.leasePrincipal.value).toBe(0);
    expect(bundle.missingOptional).toContain('cashflow.leasePrincipalPayments');
    expect(bundle.missingOptional).toContain('cashflow.distributionsToOwners');
  });

  it('rejects mixed currencies in one window', () => {
    const quarters = standardWindow();
    quarters[2] = mkQuarter({ label: '2025-Q4', currency: 'USD', operatingProfit: 18.75, da: 6.25,
      interestExpense: 5, taxExpense: 2.5, cash: 50, currentAssets: 200, currentLiabilities: 160,
      stb: 100, cpltd: 50, ltd: 180, leaseCur: 8, leaseNon: 12, cashTaxesPaid: 2.5,
      cashInterestPaid: 5, capex: 10, schedPrincipal: 6.25 });
    expect(() => resolveBundle(quarters, '2026-Q1', testDefinitions())).toThrowError(/unit mismatch/i);
  });

  it('LTM window requires four consecutive quarters', () => {
    const quarters = standardWindow().filter((q) => q.period.label !== '2025-Q3');
    quarters.push(mkQuarter({ label: '2025-Q1', operatingProfit: 18.75, da: 6.25, interestExpense: 5,
      taxExpense: 2.5, cash: 50, currentAssets: 200, currentLiabilities: 160, stb: 100, cpltd: 50,
      ltd: 180, leaseCur: 8, leaseNon: 12, cashTaxesPaid: 2.5, cashInterestPaid: 5, capex: 10,
      schedPrincipal: 6.25 }));
    try {
      ltmWindow(quarters, '2026-Q1');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as EngineError).code).toBe('INSUFFICIENT_HISTORY');
    }
  });

  it('latestQuarterOnOrBefore picks by period end date', () => {
    const quarters = standardWindow();
    expect(latestQuarterOnOrBefore(quarters, '2026-06-30').period.label).toBe('2026-Q1');
    expect(latestQuarterOnOrBefore(quarters, '2025-12-31').period.label).toBe('2025-Q4');
    expect(() => latestQuarterOnOrBefore(quarters, '2024-01-01')).toThrowError(EngineError);
  });

  it('resolveBundleSeries yields one bundle per quarter with a full window', () => {
    const eight = [...standardWindow().map((q) => q), ...standardWindow().map((q) => ({
      ...q,
      period: { ...q.period, label: q.period.label.replace('2025', '2024').replace('2026', '2025') },
    }))];
    const series = resolveBundleSeries(eight, testDefinitions());
    // 8 quarters → windows complete from the 4th onwards = 5 bundles
    expect(series.bundles.length).toBe(5);
    expect(series.warnings).toEqual([]);
  });
});

function contractOneTime() {
  return {
    kind: 'value' as const,
    label: 'One-time cost',
    value: 3,
    unit: { kind: 'money' as const, currency: 'PEN', scale: 1000 },
    period: '2026-Q1',
    source: { docId: 'filing-2026-Q1', sectionId: 'notas', locator: 'one-time' },
  };
}
