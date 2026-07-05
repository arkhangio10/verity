import type { CompanyRef, FreshnessInfo, QuarterFinancials, SourceDocument } from '@covenant/core';

/**
 * The country boundary. The calculation engine and the agent are identical
 * for every country; everything country-specific — data source, language,
 * currency, accounting-standard quirks — lives behind this interface.
 * Adding Mexico/Chile/US means adding one adapter module, nothing else.
 */
export interface AdapterFetchOptions {
  companyId: string;
  fromYear?: number;
  toYear?: number;
  /** Statement currency for the engine; adapters convert when asked. */
  targetCurrency?: string;
  /** FX rate to apply when converting, with its citation. */
  fx?: { usdPen: number; source: { docId: string; sectionId?: string; locator?: string } };
}

export interface AdapterResult {
  company: CompanyRef;
  quarters: QuarterFinancials[];
  /** Human-readable renderings of the source filings, for the citation viewer.
   *  May be empty when the app supplies richer documents itself. */
  documents: SourceDocument[];
  warnings: string[];
  sourceSystem: string;
}

export interface FilingTextMeta {
  companyId: string;
  companyName: string;
  year: number;
  quarter: 1 | 2 | 3 | 4;
  filedAt?: string;
  /** Document id to cite for values parsed out of this text. */
  docId: string;
}

/** Same shape the agent consumes (core's FreshnessInfo). */
export type FreshnessReport = FreshnessInfo;

export interface CountryAdapter {
  readonly countryCode: string;
  readonly countryName: string;
  readonly accountingStandard: string;
  readonly defaultCurrency: string;
  /** Primary path: structured statements from the country's public data source. */
  fetchStatements(opts: AdapterFetchOptions): Promise<AdapterResult>;
  /** Secondary path: parse a filing from extracted text (PDF pipeline). */
  parseFilingText(text: string, meta: FilingTextMeta): Promise<AdapterResult>;
  assessFreshness(quarters: QuarterFinancials[], asOfDateISO: string): FreshnessReport;
}
