import type { SourceRef } from './citations';
import type { CovenantSpec, MetricDefinitions } from './definitions';
import type { CorpusChunk, SourceDocument } from './documents';
import type { CompanyRef, QuarterFinancials } from './statements';

/** Data shapes shared by the agent, the adapters and the sample dataset. */
export type LedgerCategory =
  | 'distribution'
  | 'revolver_draw'
  | 'term_draw'
  | 'term_amortization'
  | 'lease_addition'
  | 'capex_payment'
  | 'tax_payment'
  | 'interest_payment'
  | 'operating_inflow'
  | 'operating_outflow'
  | 'one_time_cost'
  | 'other';

/** A categorized treasury/ledger movement, as a bank-side monitoring system
 *  would receive it. Amounts are positive magnitudes in statement units;
 *  `direction` carries the sign, `non_cash` marks e.g. new lease liabilities. */
export interface LedgerEntry {
  id: string;
  date: string;
  category: LedgerCategory;
  amount: number;
  direction: 'inflow' | 'outflow' | 'non_cash';
  counterparty: string;
  memo: string;
  source: SourceRef;
}

export interface AgreementInfo {
  docId: string;
  title: string;
  signedDate: string;
  covenants: CovenantSpec[];
  definitions: MetricDefinitions;
  /** Exact clause quotes for verbatim verification of each definition. */
  verbatimChecks: { subject: string; sectionId: string; quote: string }[];
}

export interface FreshnessInfo {
  latestPeriodEnd: string;
  latestFiledAt?: string;
  ageDays: number | null;
  stale: boolean;
  policyMaxAgeDays: number;
}

export interface AdapterInfo {
  countryCode: string;
  countryName: string;
  accountingStandard: string;
  currency: string;
  sourceSystem: string;
}

/** Everything an agent run needs, assembled by the application layer from a
 *  country adapter + document store. The agent itself is dataset- and
 *  country-agnostic. */
export interface RunDataset {
  company: CompanyRef;
  asOfDate: string;
  quarters: QuarterFinancials[];
  documents: SourceDocument[];
  corpus: CorpusChunk[];
  transactions: LedgerEntry[];
  agreement: AgreementInfo | null;
  freshness: FreshnessInfo;
  adapter: AdapterInfo;
  fx?: { pair: string; rate: number; source: SourceRef };
}
