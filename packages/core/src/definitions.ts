import type { SourceRef } from './citations';
import { STANDARD_DEFINITIONS_DOC_ID } from './documents';
import { quarterIndex } from './periods';

/**
 * Contract definitions override standard accounting. Every metric the engine
 * computes is parameterized by one of these definition objects, so "Covenant
 * EBITDA", "Total Debt", "unfinanced CapEx" etc. can be redefined per credit
 * agreement (add-backs, caps, lease treatment, cash vs accrual interest)
 * without touching the calculation code.
 */

export interface AddBack {
  key: 'stockCompensation' | 'oneTimeItems';
  description: string;
  /** Cap on the add-back per trailing-twelve-month test period, in statement units. */
  capPerLtm?: number;
  clauseRef?: SourceRef;
}

export interface EbitdaDefinition {
  name: string;
  /** Build-up basis. Operating profit + D&A is the auditable default. */
  base: 'operatingProfitPlusDA';
  addBacks: AddBack[];
  clauseRef?: SourceRef;
}

export interface DebtDefinition {
  name: string;
  includeShortTermBorrowings: boolean;
  includeCurrentPortionLongTermDebt: boolean;
  includeLongTermDebt: boolean;
  /** IFRS 16 / NIIF 16 decision: whether lease liabilities count as debt. */
  includeLeaseLiabilities: boolean;
  clauseRef?: SourceRef;
}

export interface CashTaxesDefinition {
  source: 'cashflow.cashTaxesPaid' | 'income.taxExpense';
  clauseRef?: SourceRef;
}

export interface DebtServiceDefinition {
  interestBasis: 'cash' | 'accrual';
  includeLeasePrincipal: boolean;
  clauseRef?: SourceRef;
}

export interface CapexDefinition {
  basis: 'unfinanced' | 'gross';
  clauseRef?: SourceRef;
}

export interface MetricDefinitions {
  ebitda: EbitdaDefinition;
  debt: DebtDefinition;
  cashTaxes: CashTaxesDefinition;
  debtService: DebtServiceDefinition;
  capex: CapexDefinition;
}

export type RatioKey = 'dscr' | 'leverage' | 'icr' | 'current_ratio' | 'fccr';

export const RATIO_LABELS: Record<RatioKey, string> = {
  dscr: 'Debt Service Coverage Ratio',
  leverage: 'Net Leverage Ratio',
  icr: 'Interest Coverage Ratio',
  current_ratio: 'Current Ratio',
  fccr: 'Fixed Charge Coverage Ratio',
};

export type Comparator = 'max' | 'min';

export interface StepDown {
  /** First test period (quarter label) at which this threshold applies. */
  fromPeriod: string;
  threshold: number;
}

export interface CovenantSpec {
  id: string;
  name: string;
  ratio: RatioKey;
  comparator: Comparator;
  threshold: number;
  stepDowns?: StepDown[];
  testBasis: 'ltm' | 'point_in_time';
  frequency: 'quarterly';
  clauseRef?: SourceRef;
  definitionNotes?: string;
}

/** Effective threshold at a test period, honoring step-downs. */
export function thresholdForPeriod(spec: CovenantSpec, periodLabel: string): number {
  let effective = spec.threshold;
  if (spec.stepDowns) {
    const idx = quarterIndex(periodLabel);
    for (const sd of [...spec.stepDowns].sort((a, b) => quarterIndex(a.fromPeriod) - quarterIndex(b.fromPeriod))) {
      if (quarterIndex(sd.fromPeriod) <= idx) effective = sd.threshold;
    }
  }
  return effective;
}

function templateRef(sectionId: string, sectionTitle: string): SourceRef {
  return {
    docId: STANDARD_DEFINITIONS_DOC_ID,
    docTitle: 'Standard Definition Templates',
    sectionId,
    sectionTitle,
  };
}

/** Fallback templates used when no executed agreement governs (BEFORE mode).
 *  They are themselves cited, to a rendered template document. */
export function defaultDefinitions(): MetricDefinitions {
  return {
    ebitda: {
      name: 'EBITDA (template)',
      base: 'operatingProfitPlusDA',
      addBacks: [
        {
          key: 'stockCompensation',
          description: 'Non-cash stock-based compensation',
          clauseRef: templateRef('ebitda', 'EBITDA'),
        },
      ],
      clauseRef: templateRef('ebitda', 'EBITDA'),
    },
    debt: {
      name: 'Total Debt (template)',
      includeShortTermBorrowings: true,
      includeCurrentPortionLongTermDebt: true,
      includeLongTermDebt: true,
      includeLeaseLiabilities: true,
      clauseRef: templateRef('total-debt', 'Total Debt'),
    },
    cashTaxes: {
      source: 'cashflow.cashTaxesPaid',
      clauseRef: templateRef('cash-taxes', 'Cash Taxes'),
    },
    debtService: {
      interestBasis: 'cash',
      includeLeasePrincipal: true,
      clauseRef: templateRef('debt-service', 'Debt Service'),
    },
    capex: {
      basis: 'unfinanced',
      clauseRef: templateRef('capex', 'Unfinanced Capital Expenditures'),
    },
  };
}
