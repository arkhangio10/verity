import type { Estado } from './terms';

/**
 * Normalized ingest shape for Peru's SMV (Superintendencia del Mercado de
 * Valores) quarterly information. The live Open Data service is reached by
 * LiveSmvClient below; the demo dataset ships fixtures in the same shape, so
 * the entire mapping pipeline is exercised without network access.
 */
export interface SmvStatementRecord {
  estado: Estado;
  /** SMV account code (e.g. "1D0101"); "NR-*" marks one-time items from notes. */
  cuenta: string;
  descripcion: string;
  monto: number;
}

export interface SmvFilingRecord {
  rmvCode: string;
  razonSocial: string;
  ticker?: string;
  sector?: string;
  anio: number;
  trimestre: 1 | 2 | 3 | 4;
  moneda: 'PEN' | 'USD';
  escala: number;
  fechaPresentacion: string;
  registros: SmvStatementRecord[];
  /** Rendered human-readable filing for citations (docId + section per statement). */
  docRef?: {
    docId: string;
    sectionByEstado: Record<Estado, string>;
    notasSectionId?: string;
  };
  metadatos?: {
    /** Floating-rate share of financial debt disclosed in the notes (0..1). */
    deudaTasaVariablePct?: number;
  };
}

export interface SmvClient {
  readonly sourceName: string;
  fetchFilings(companyId: string, opts?: { fromYear?: number; toYear?: number }): Promise<SmvFilingRecord[]>;
}

export interface LiveSmvConfig {
  baseUrl: string;
  timeoutMs: number;
}

export function smvConfigFromEnv(env: Record<string, string | undefined> = process.env): LiveSmvConfig {
  return {
    baseUrl: (env.SMV_BASE_URL ?? 'https://www.smv.gob.pe').replace(/\/+$/, ''),
    timeoutMs: Number(env.SMV_TIMEOUT_MS ?? 30_000),
  };
}

/**
 * Live client for SMV's public web services. The exact payload of the Open
 * Data endpoint varies by service version, so the response mapping is
 * injectable: pass `mapResponse` that turns the service's JSON into
 * SmvFilingRecord[]. The default mapper accepts data already in that shape
 * (e.g. an internal proxy that normalizes SMV responses).
 */
export class LiveSmvClient implements SmvClient {
  readonly sourceName = 'SMV Open Data (live)';

  constructor(
    private readonly config: LiveSmvConfig,
    private readonly mapResponse: (json: unknown) => SmvFilingRecord[] = defaultMapResponse,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async fetchFilings(
    companyId: string,
    opts: { fromYear?: number; toYear?: number } = {},
  ): Promise<SmvFilingRecord[]> {
    const params = new URLSearchParams({ rmv: companyId });
    if (opts.fromYear) params.set('desde', String(opts.fromYear));
    if (opts.toYear) params.set('hasta', String(opts.toYear));
    const url = `${this.config.baseUrl}/api/informacion-financiera/trimestral?${params.toString()}`;
    const res = await this.fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`SMV service returned HTTP ${res.status} for ${companyId}`);
    }
    return this.mapResponse((await res.json()) as unknown);
  }
}

function defaultMapResponse(json: unknown): SmvFilingRecord[] {
  if (!Array.isArray(json)) {
    throw new Error('unexpected SMV payload: expected an array of filings (configure a custom mapResponse)');
  }
  return json as SmvFilingRecord[];
}
