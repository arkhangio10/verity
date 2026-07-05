import {
  citedValue,
  moneyUnit,
  PERCENT_UNIT,
  type CitedValue,
  type MetricDefinitions,
  type QuarterFinancials,
  type SourceRef,
} from '@covenant/core';

export interface QuarterNumbers {
  label: string;
  currency?: string;
  operatingProfit?: number;
  da?: number;
  interestExpense?: number;
  taxExpense?: number;
  stockComp?: number;
  oneTime?: number[];
  revenue?: number;
  cash?: number;
  currentAssets?: number;
  currentLiabilities?: number;
  stb?: number;
  cpltd?: number;
  ltd?: number;
  leaseCur?: number;
  leaseNon?: number;
  cashTaxesPaid?: number;
  cashInterestPaid?: number;
  capex?: number;
  leaseFinanced?: number;
  schedPrincipal?: number;
  leasePrincipal?: number;
  distributions?: number;
  floatingShare?: number;
}

function quarterDates(label: string): { startDate: string; endDate: string } {
  const [y, q] = label.split('-Q');
  const quarter = Number(q);
  const year = Number(y);
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = quarter * 3;
  const endDay = [31, 30, 30, 31][quarter - 1] ?? 31;
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    startDate: `${year}-${pad(startMonth)}-01`,
    endDate: `${year}-${pad(endMonth)}-${endDay}`,
  };
}

export function mkQuarter(n: QuarterNumbers): QuarterFinancials {
  const currency = n.currency ?? 'PEN';
  const unit = moneyUnit(currency, 1000);
  const src = (locator: string): SourceRef => ({
    docId: `filing-${n.label}`,
    docTitle: `Filing ${n.label}`,
    sectionId: 'statements',
    locator,
  });
  const cv = (label: string, value: number | undefined): CitedValue | undefined =>
    value === undefined
      ? undefined
      : citedValue({ label, value, unit, source: src(label), period: n.label });

  const { startDate, endDate } = quarterDates(n.label);
  return {
    period: { label: n.label, startDate, endDate, filedAt: endDate },
    currency,
    scale: 1000,
    income: {
      revenue: cv('Revenue', n.revenue),
      operatingProfit: cv('Operating profit', n.operatingProfit),
      depreciationAmortization: cv('Depreciation & amortization', n.da),
      interestExpense: cv('Interest expense', n.interestExpense),
      taxExpense: cv('Tax expense', n.taxExpense),
      stockCompensation: cv('Stock compensation', n.stockComp),
      oneTimeItems: n.oneTime?.map((v, i) => citedValue({
        label: `One-time item ${i + 1}`,
        value: v,
        unit,
        source: src(`one-time-${i + 1}`),
        period: n.label,
      })),
    },
    balance: {
      cashAndEquivalents: cv('Cash & equivalents', n.cash),
      currentAssets: cv('Current assets', n.currentAssets),
      currentLiabilities: cv('Current liabilities', n.currentLiabilities),
      shortTermBorrowings: cv('Short-term borrowings', n.stb),
      currentPortionLongTermDebt: cv('Current portion of LTD', n.cpltd),
      longTermDebt: cv('Long-term debt', n.ltd),
      leaseLiabilitiesCurrent: cv('Lease liabilities (current)', n.leaseCur),
      leaseLiabilitiesNonCurrent: cv('Lease liabilities (non-current)', n.leaseNon),
    },
    cashflow: {
      cashTaxesPaid: cv('Cash taxes paid', n.cashTaxesPaid),
      cashInterestPaid: cv('Cash interest paid', n.cashInterestPaid),
      capitalExpenditures: cv('Capital expenditures', n.capex),
      leaseFinancedCapex: cv('Lease-financed capex', n.leaseFinanced),
      scheduledPrincipalPayments: cv('Scheduled principal payments', n.schedPrincipal),
      leasePrincipalPayments: cv('Lease principal payments', n.leasePrincipal),
      distributionsToOwners: cv('Distributions to owners', n.distributions),
    },
    extras:
      n.floatingShare === undefined
        ? undefined
        : {
            floatingRateDebtShare: citedValue({
              label: 'Floating-rate debt share',
              value: n.floatingShare,
              unit: PERCENT_UNIT,
              source: src('floating-share'),
              period: n.label,
            }),
          },
  };
}

/** Four identical quarters ending 2026-Q1; per-quarter values are LTM ÷ 4. */
export function standardWindow(overrides: Partial<QuarterNumbers> = {}): QuarterFinancials[] {
  const labels = ['2025-Q2', '2025-Q3', '2025-Q4', '2026-Q1'];
  return labels.map((label) =>
    mkQuarter({
      label,
      operatingProfit: 18.75,
      da: 6.25,
      interestExpense: 5,
      taxExpense: 2.5,
      stockComp: 1,
      cash: 50,
      currentAssets: 200,
      currentLiabilities: 160,
      stb: 100,
      cpltd: 50,
      ltd: 180,
      leaseCur: 8,
      leaseNon: 12,
      cashTaxesPaid: 2.5,
      cashInterestPaid: 5,
      capex: 10,
      leaseFinanced: 2.5,
      schedPrincipal: 6.25,
      leasePrincipal: 1.25,
      distributions: 5,
      floatingShare: 0.5,
      ...overrides,
    }),
  );
}

/** Agreement-style definitions used across engine tests. */
export function testDefinitions(): MetricDefinitions {
  const clause = (sectionId: string): SourceRef => ({
    docId: 'credit-agreement-test',
    sectionId,
  });
  return {
    ebitda: {
      name: 'Covenant EBITDA (test)',
      base: 'operatingProfitPlusDA',
      addBacks: [
        { key: 'stockCompensation', description: 'Stock compensation', clauseRef: clause('1.1') },
        { key: 'oneTimeItems', description: 'One-time items', capPerLtm: 5, clauseRef: clause('1.1') },
      ],
      clauseRef: clause('1.1'),
    },
    debt: {
      name: 'Total Debt (test)',
      includeShortTermBorrowings: true,
      includeCurrentPortionLongTermDebt: true,
      includeLongTermDebt: true,
      includeLeaseLiabilities: true,
      clauseRef: clause('1.2'),
    },
    cashTaxes: { source: 'cashflow.cashTaxesPaid', clauseRef: clause('1.3') },
    debtService: { interestBasis: 'cash', includeLeasePrincipal: true, clauseRef: clause('1.4') },
    capex: { basis: 'unfinanced', clauseRef: clause('1.5') },
  };
}
