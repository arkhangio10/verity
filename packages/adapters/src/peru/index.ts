import { daysBetween, sortQuarters, type QuarterFinancials } from '@covenant/core';
import type {
  AdapterFetchOptions,
  AdapterResult,
  CountryAdapter,
  FilingTextMeta,
  FreshnessReport,
} from '../types';
import { companyFromFiling, mapFilingToQuarter } from './mapper';
import { parseFilingTextToRecords } from './pdf';
import type { SmvClient, SmvFilingRecord } from './smv';

export interface PeruAdapterOptions {
  smvClient: SmvClient;
  /** Quarterly filings older than this are flagged stale (SMV grants ~45 days
   *  after quarter end; 135 ≈ one missed quarter plus the filing window). */
  freshnessMaxAgeDays?: number;
}

/**
 * Peru adapter: SMV Open Data structured statements as the primary path, PDF
 * filing text as the secondary path. Handles Spanish NIIF terminology, PEN
 * (USD optional via cited FX), NIIF 16 lease liabilities and filing-date
 * staleness. The engine and agent never see anything Peru-specific.
 */
export class PeruAdapter implements CountryAdapter {
  readonly countryCode = 'PE';
  readonly countryName = 'Peru';
  readonly accountingStandard = 'IFRS (NIIF)';
  readonly defaultCurrency = 'PEN';
  private readonly maxAgeDays: number;

  constructor(private readonly options: PeruAdapterOptions) {
    this.maxAgeDays = options.freshnessMaxAgeDays ?? 135;
  }

  async fetchStatements(opts: AdapterFetchOptions): Promise<AdapterResult> {
    const filings = await this.options.smvClient.fetchFilings(opts.companyId, {
      fromYear: opts.fromYear,
      toYear: opts.toYear,
    });
    if (filings.length === 0) {
      throw new Error(`SMV returned no filings for company "${opts.companyId}"`);
    }
    return this.mapFilings(filings, opts);
  }

  async parseFilingText(text: string, meta: FilingTextMeta): Promise<AdapterResult> {
    const parsed = parseFilingTextToRecords(text);
    const filing: SmvFilingRecord = {
      rmvCode: meta.companyId,
      razonSocial: meta.companyName,
      anio: meta.year,
      trimestre: meta.quarter,
      moneda: 'PEN',
      escala: 1000,
      fechaPresentacion: meta.filedAt ?? `${meta.year}-12-31`,
      registros: parsed.records,
      docRef: {
        docId: meta.docId,
        sectionByEstado: { ESF: 'estado-situacion', ER: 'estado-resultados', EFE: 'estado-flujos' },
        notasSectionId: 'notas',
      },
    };
    const result = this.mapFilings([filing], { companyId: meta.companyId });
    result.warnings.push(...parsed.warnings.map((w) => `pdf: ${w}`));
    result.sourceSystem = 'PDF filing (text extraction)';
    return result;
  }

  private mapFilings(filings: SmvFilingRecord[], opts: AdapterFetchOptions): AdapterResult {
    const warnings: string[] = [];
    const quarters: QuarterFinancials[] = [];
    for (const filing of filings) {
      const mapped = mapFilingToQuarter(filing, {
        targetCurrency: opts.targetCurrency ?? this.defaultCurrency,
        fx: opts.fx ? { usdPen: opts.fx.usdPen, source: opts.fx.source } : undefined,
      });
      quarters.push(mapped.quarter);
      warnings.push(...mapped.warnings);
    }
    const first = filings[0];
    if (!first) throw new Error('no filings to map');
    return {
      company: companyFromFiling(first),
      quarters: sortQuarters(quarters),
      documents: [],
      warnings,
      sourceSystem: this.options.smvClient.sourceName,
    };
  }

  assessFreshness(quarters: QuarterFinancials[], asOfDateISO: string): FreshnessReport {
    const sorted = sortQuarters(quarters);
    const latest = sorted[sorted.length - 1];
    if (!latest) {
      return {
        latestPeriodEnd: 'n/a',
        ageDays: null,
        stale: true,
        policyMaxAgeDays: this.maxAgeDays,
      };
    }
    const reference = latest.period.filedAt ?? latest.period.endDate;
    const ageDays = daysBetween(reference, asOfDateISO);
    return {
      latestPeriodEnd: latest.period.endDate,
      latestFiledAt: latest.period.filedAt,
      ageDays,
      stale: ageDays > this.maxAgeDays || ageDays < 0,
      policyMaxAgeDays: this.maxAgeDays,
    };
  }
}
