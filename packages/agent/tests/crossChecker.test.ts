import { describe, expect, it } from 'vitest';
import { netDebtEffect, type LedgerEntry } from '@covenant/agent';

function entry(category: LedgerEntry['category'], amount: number, direction: LedgerEntry['direction']): LedgerEntry {
  return {
    id: 'tx-test',
    date: '2026-02-15',
    category,
    amount,
    direction,
    counterparty: 'Test',
    memo: 'test',
    source: { docId: 'transaction-ledger', sectionId: 'tx-test' },
  };
}

describe('deterministic net-debt attribution rules', () => {
  it('distributions raise net debt one-for-one (cash leaves, debt unchanged)', () => {
    expect(netDebtEffect(entry('distribution', 45_000, 'outflow'))).toBe(45_000);
  });

  it('revolver/term draws are net-debt neutral (cash and debt rise together)', () => {
    expect(netDebtEffect(entry('revolver_draw', 32_000, 'inflow'))).toBe(0);
    expect(netDebtEffect(entry('term_draw', 30_000, 'inflow'))).toBe(0);
  });

  it('scheduled amortization is net-debt neutral (cash and debt fall together)', () => {
    expect(netDebtEffect(entry('term_amortization', 6_500, 'outflow'))).toBe(0);
  });

  it('new lease liabilities raise net debt without cash (IFRS 16)', () => {
    expect(netDebtEffect(entry('lease_addition', 7_000, 'non_cash'))).toBe(7_000);
  });

  it('operating inflows reduce net debt; outflows raise it', () => {
    expect(netDebtEffect(entry('operating_inflow', 28_000, 'inflow'))).toBe(-28_000);
    expect(netDebtEffect(entry('capex_payment', 9_300, 'outflow'))).toBe(9_300);
    expect(netDebtEffect(entry('tax_payment', 3_800, 'outflow'))).toBe(3_800);
  });

  it('uncategorized movements follow their cash direction', () => {
    expect(netDebtEffect(entry('other', 1_000, 'outflow'))).toBe(1_000);
    expect(netDebtEffect(entry('other', 1_000, 'inflow'))).toBe(-1_000);
    expect(netDebtEffect(entry('other', 1_000, 'non_cash'))).toBe(0);
  });
});
