import { PeruAdapter, type SmvClient, type SmvFilingRecord } from '@covenant/adapters';
import { chunksFromDocuments, type RunDataset, type SourceDocument } from '@covenant/core';
import { AGREEMENT_DOC_ID, buildAgreementInfo, renderAgreementDocument } from './agreement';
import { buildSmvFilings } from './buildSmv';
import { renderFilingDocuments } from './filings';
import { renderMarketStandardsDocument, renderStandardDefinitionsDocument } from './knowledge';
import { buildQuarters, COMPANY, DEFAULT_AS_OF } from './seed';
import { buildLedger, renderLedgerDocument } from './transactions';

/** In-memory SmvClient over the generated fixtures — the demo ingests data
 *  through the real PeruAdapter pipeline, exactly like a live SMV pull. */
export class FixtureSmvClient implements SmvClient {
  readonly sourceName = 'SMV Open Data (bundled fixtures)';

  constructor(private readonly filings: SmvFilingRecord[]) {}

  async fetchFilings(
    companyId: string,
    opts: { fromYear?: number; toYear?: number } = {},
  ): Promise<SmvFilingRecord[]> {
    return this.filings.filter(
      (f) =>
        f.rmvCode === companyId &&
        (opts.fromYear === undefined || f.anio >= opts.fromYear) &&
        (opts.toYear === undefined || f.anio <= opts.toYear),
    );
  }
}

export interface DemoDatasetOptions {
  asOfDate?: string;
}

let cached: Promise<RunDataset> | null = null;

/** Assemble the full demo dataset through the Peru adapter. Cached — the
 *  data is deterministic, so one build serves every run. */
export function buildDemoDataset(options: DemoDatasetOptions = {}): Promise<RunDataset> {
  if (options.asOfDate === undefined && cached) return cached;
  const promise = assemble(options);
  if (options.asOfDate === undefined) cached = promise;
  return promise;
}

async function assemble(options: DemoDatasetOptions): Promise<RunDataset> {
  const asOfDate = options.asOfDate ?? DEFAULT_AS_OF;
  const built = buildQuarters();
  const smvClient = new FixtureSmvClient(buildSmvFilings(built));
  const adapter = new PeruAdapter({ smvClient });

  const result = await adapter.fetchStatements({ companyId: COMPANY.id });
  if (result.warnings.length > 0) {
    throw new Error(`demo dataset should map cleanly, got warnings: ${result.warnings.join(' | ')}`);
  }

  const documents: SourceDocument[] = [
    renderAgreementDocument(),
    ...renderFilingDocuments(built),
    renderStandardDefinitionsDocument(),
    renderMarketStandardsDocument(),
  ];
  const transactions = buildLedger();
  documents.push(renderLedgerDocument(transactions));

  return {
    company: { ...result.company, sector: COMPANY.sector },
    asOfDate,
    quarters: result.quarters,
    documents,
    corpus: chunksFromDocuments(documents),
    transactions,
    agreement: buildAgreementInfo(),
    freshness: adapter.assessFreshness(result.quarters, asOfDate),
    adapter: {
      countryCode: adapter.countryCode,
      countryName: adapter.countryName,
      accountingStandard: adapter.accountingStandard,
      currency: adapter.defaultCurrency,
      sourceSystem: result.sourceSystem,
    },
    fx: {
      pair: 'USD/PEN',
      rate: 3.75,
      source: {
        docId: 'market-standards',
        docTitle: 'Market Standards for Covenant Packages',
        sectionId: 'conventions',
        locator: 'reference FX (illustrative)',
      },
    },
  };
}

export { AGREEMENT_DOC_ID };
