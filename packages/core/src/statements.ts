import type { CitedValue } from './citations';
import type { PeriodMeta } from './periods';

export interface CompanyRef {
  id: string;
  name: string;
  countryCode: string;
  ticker?: string;
  sector?: string;
}

/** Canonical statement model the engine understands. Country adapters map
 *  local taxonomies (e.g. Peru's Spanish NIIF line items) into this shape.
 *  Fields are optional because real filings vary; the resolver decides which
 *  are required for a given metric and raises MISSING_INPUT otherwise. */
export interface IncomeStatement {
  revenue?: CitedValue;
  operatingProfit?: CitedValue;
  depreciationAmortization?: CitedValue;
  interestExpense?: CitedValue;
  taxExpense?: CitedValue;
  netIncome?: CitedValue;
  stockCompensation?: CitedValue;
  /** Unusual / one-time items eligible as EBITDA add-backs (per definition). */
  oneTimeItems?: CitedValue[];
}

export interface BalanceSheet {
  cashAndEquivalents?: CitedValue;
  accountsReceivable?: CitedValue;
  inventory?: CitedValue;
  otherCurrentAssets?: CitedValue;
  currentAssets?: CitedValue;
  propertyPlantEquipment?: CitedValue;
  rightOfUseAssets?: CitedValue;
  otherNonCurrentAssets?: CitedValue;
  totalAssets?: CitedValue;
  shortTermBorrowings?: CitedValue;
  currentPortionLongTermDebt?: CitedValue;
  leaseLiabilitiesCurrent?: CitedValue;
  accountsPayable?: CitedValue;
  otherCurrentLiabilities?: CitedValue;
  currentLiabilities?: CitedValue;
  longTermDebt?: CitedValue;
  leaseLiabilitiesNonCurrent?: CitedValue;
  otherNonCurrentLiabilities?: CitedValue;
  totalLiabilities?: CitedValue;
  totalEquity?: CitedValue;
}

export interface CashFlowStatement {
  cashTaxesPaid?: CitedValue;
  cashInterestPaid?: CitedValue;
  capitalExpenditures?: CitedValue;
  /** Portion of capex financed by leases/vendor debt (non-cash additions). */
  leaseFinancedCapex?: CitedValue;
  scheduledPrincipalPayments?: CitedValue;
  leasePrincipalPayments?: CitedValue;
  distributionsToOwners?: CitedValue;
}

export interface QuarterExtras {
  /** Share of total debt bearing floating rates (0..1); needed for rate shocks. */
  floatingRateDebtShare?: CitedValue;
}

export interface QuarterFinancials {
  period: PeriodMeta;
  currency: string;
  /** Statement scale: values are expressed in `scale` currency units (1000 = thousands). */
  scale: number;
  income: IncomeStatement;
  balance: BalanceSheet;
  cashflow: CashFlowStatement;
  extras?: QuarterExtras;
}

export type BalanceField = keyof BalanceSheet;
export type IncomeField = Exclude<keyof IncomeStatement, 'oneTimeItems'>;
export type CashFlowField = keyof CashFlowStatement;

export type CanonicalFieldPath =
  | `balance.${BalanceField}`
  | `income.${IncomeField}`
  | `cashflow.${CashFlowField}`;

/** Adapter-facing setter so mapping code can stay table-driven. */
export function setField(q: QuarterFinancials, path: CanonicalFieldPath, value: CitedValue): void {
  const [statement, field] = path.split('.') as [string, string];
  if (statement === 'balance') (q.balance as Record<string, CitedValue>)[field] = value;
  else if (statement === 'income') (q.income as Record<string, CitedValue>)[field] = value;
  else (q.cashflow as Record<string, CitedValue>)[field] = value;
}

export function getField(q: QuarterFinancials, path: CanonicalFieldPath): CitedValue | undefined {
  const [statement, field] = path.split('.') as [string, string];
  const bucket =
    statement === 'balance' ? q.balance : statement === 'income' ? q.income : q.cashflow;
  return (bucket as Record<string, CitedValue | undefined>)[field];
}
