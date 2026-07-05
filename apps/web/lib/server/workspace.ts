import {
  chunksFromDocuments,
  defaultDefinitions,
  latestQuarterOnOrBefore,
  sortQuarters,
  STANDARD_DEFINITIONS_DOC_ID,
  type AgreementInfo,
  type CovenantSpec,
  type LedgerEntry,
  type QuarterFinancials,
  type RunDataset,
  type SourceDocument,
} from '@covenant/core';
import { PeruAdapter, type SmvClient, type SmvFilingRecord } from '@covenant/adapters';
import { renderStandardDefinitionsDocument, renderMarketStandardsDocument } from '@covenant/sample-data';

/**
 * A user-created company workspace. Unlike the base demo case (a fixed
 * RunDataset), a workspace accumulates uploaded filings and covenant choices
 * across requests, then assembles a *real* RunDataset the agent computes on —
 * only once it has enough data (readiness gate).
 */
export interface CompanyWorkspace {
  id: string;
  name: string;
  countryCode: string;
  currency: string;
  createdAtISO: string;
  /** Raw SMV-shaped filings the user uploaded, keyed by period label. */
  filings: Map<string, SmvFilingRecord>;
  /** Covenant thresholds the user set (empty → BEFORE mode only). */
  covenants: CovenantSpec[];
  /** Optional transactions the user uploaded (rare; usually empty). */
  transactions: LedgerEntry[];
  /** Documents to make citable (rendered filings, an uploaded agreement text…). */
  extraDocuments: SourceDocument[];
}

const globalStore = globalThis as unknown as { __verityWorkspaces?: Map<string, CompanyWorkspace> };
const store: Map<string, CompanyWorkspace> = globalStore.__verityWorkspaces ?? new Map();
globalStore.__verityWorkspaces = store;

function key(sessionId: string, companyId: string): string {
  return `${sessionId}::${companyId}`;
}

export function createWorkspace(
  sessionId: string,
  args: { name: string; countryCode?: string; currency?: string },
  nowISO: string,
): CompanyWorkspace {
  const id = `co-${slug(args.name)}-${store.size + 1}`;
  const ws: CompanyWorkspace = {
    id,
    name: args.name.trim() || 'Empresa sin nombre',
    countryCode: args.countryCode ?? 'PE',
    currency: args.currency ?? 'PEN',
    createdAtISO: nowISO,
    filings: new Map(),
    covenants: [],
    transactions: [],
    extraDocuments: [],
  };
  store.set(key(sessionId, id), ws);
  return ws;
}

export function getWorkspace(sessionId: string, companyId: string): CompanyWorkspace | undefined {
  return store.get(key(sessionId, companyId));
}

export function listWorkspaces(sessionId: string): CompanyWorkspace[] {
  const out: CompanyWorkspace[] = [];
  for (const [k, ws] of store) if (k.startsWith(`${sessionId}::`)) out.push(ws);
  return out;
}

export function addFilingToWorkspace(ws: CompanyWorkspace, filing: SmvFilingRecord): void {
  const label = `${filing.anio}-Q${filing.trimestre}`;
  const docId = `ws-filing-${ws.id}-${label}`;
  // stamp the company identity + a stable docId so citations resolve
  const stamped: SmvFilingRecord = {
    ...filing,
    rmvCode: ws.id,
    razonSocial: ws.name,
    docRef: {
      docId,
      sectionByEstado: { ESF: 'estado-situacion', ER: 'estado-resultados', EFE: 'estado-flujos' },
      notasSectionId: 'notas',
    },
  };
  ws.filings.set(label, stamped);
  // render a citable document for this filing
  ws.extraDocuments = ws.extraDocuments.filter((d) => d.id !== docId);
  ws.extraDocuments.push(renderFilingRecordDoc(docId, ws.name, label, stamped));
}

function renderFilingRecordDoc(
  docId: string,
  company: string,
  label: string,
  filing: SmvFilingRecord,
): SourceDocument {
  const byEstado = (estado: 'ESF' | 'ER' | 'EFE') =>
    filing.registros
      .filter((r) => r.estado === estado)
      .map((r) => `${r.descripcion}  ${r.monto.toLocaleString('en-US')}`)
      .join('\n');
  return {
    id: docId,
    title: `Estados Financieros ${label} — ${company} (subido)`,
    kind: 'filing',
    language: 'es',
    period: label,
    sections: [
      { id: 'estado-situacion', title: 'Estado de Situación Financiera', text: byEstado('ESF') },
      { id: 'estado-resultados', title: 'Estado de Resultados', text: byEstado('ER') },
      { id: 'estado-flujos', title: 'Estado de Flujos de Efectivo', text: byEstado('EFE') },
    ],
  };
}

// ── Readiness ────────────────────────────────────────────────────────────────

export interface Readiness {
  quarterCount: number;
  quarterLabels: string[];
  hasConsecutive4: boolean;
  hasCovenants: boolean;
  /** Can the agent run BEFORE (design) mode? Needs ≥4 consecutive quarters. */
  canRunBefore: boolean;
  /** Can the agent run AFTER (monitor) mode? Needs quarters + covenants. */
  canRunAfter: boolean;
  messages: string[];
}

export function assessReadiness(ws: CompanyWorkspace): Readiness {
  const sorted = sortQuarters([...ws.filings.values()].map(filingToQuarterStub));
  const labels = sorted.map((q) => q.period.label);
  const hasConsecutive4 = hasFourConsecutive(labels);
  const hasCovenants = ws.covenants.length > 0;
  const messages: string[] = [];
  if (labels.length < 4) {
    messages.push(`Faltan ${4 - labels.length} trimestre(s): se necesitan al menos 4 para la ventana LTM.`);
  } else if (!hasConsecutive4) {
    messages.push('Los trimestres no son 4 consecutivos; sube trimestres seguidos (p. ej. 2025-Q2…2026-Q1).');
  }
  if (!hasCovenants) {
    messages.push('Sin covenants definidos: se puede diseñar (BEFORE) pero no monitorear (AFTER).');
  }
  return {
    quarterCount: labels.length,
    quarterLabels: labels,
    hasConsecutive4,
    hasCovenants,
    canRunBefore: hasConsecutive4,
    canRunAfter: hasConsecutive4 && hasCovenants,
    messages,
  };
}

function hasFourConsecutive(labels: string[]): boolean {
  if (labels.length < 4) return false;
  const idx = labels.map(quarterIndexLite).sort((a, b) => a - b);
  for (let i = 0; i + 3 < idx.length; i++) {
    if (idx[i + 3]! - idx[i]! === 3) return true;
  }
  return false;
}

function quarterIndexLite(label: string): number {
  const m = /^(\d{4})-Q([1-4])$/.exec(label);
  return m ? Number(m[1]) * 4 + (Number(m[2]) - 1) : 0;
}

/** Cheap stub used only for sorting/labels (no mapping needed). */
function filingToQuarterStub(f: SmvFilingRecord): QuarterFinancials {
  return {
    period: { label: `${f.anio}-Q${f.trimestre}`, startDate: '', endDate: `${f.anio}-12-31` },
    currency: f.moneda,
    scale: f.escala,
    income: {},
    balance: {},
    cashflow: {},
  };
}

// ── Assemble a real RunDataset from the workspace ───────────────────────────

class WorkspaceSmvClient implements SmvClient {
  readonly sourceName = 'Documentos subidos por el usuario';
  constructor(private readonly filings: SmvFilingRecord[]) {}
  async fetchFilings(): Promise<SmvFilingRecord[]> {
    return this.filings;
  }
}

/** Build a computable RunDataset from a ready workspace. Throws if not ready. */
export async function assembleWorkspaceDataset(
  ws: CompanyWorkspace,
  asOfDateISO: string,
): Promise<RunDataset> {
  const filings = [...ws.filings.values()];
  if (filings.length === 0) throw new Error('la empresa no tiene trimestres cargados');

  const adapter = new PeruAdapter({ smvClient: new WorkspaceSmvClient(filings) });
  const result = await adapter.fetchStatements({ companyId: ws.id });
  const quarters = result.quarters;

  const asOf = clampAsOf(quarters, asOfDateISO);

  const agreement: AgreementInfo | null =
    ws.covenants.length > 0
      ? {
          docId: STANDARD_DEFINITIONS_DOC_ID,
          title: `Covenants definidos para ${ws.name} (plantilla)`,
          signedDate: ws.createdAtISO.slice(0, 10),
          covenants: ws.covenants,
          definitions: defaultDefinitions(),
          verbatimChecks: [],
        }
      : null;

  const documents: SourceDocument[] = [
    renderStandardDefinitionsDocument(),
    renderMarketStandardsDocument(),
    ...ws.extraDocuments,
  ];

  return {
    company: {
      id: ws.id,
      name: ws.name,
      countryCode: ws.countryCode,
      sector: 'Empresa creada por el usuario',
    },
    asOfDate: asOf,
    quarters,
    documents,
    corpus: chunksFromDocuments(documents),
    transactions: ws.transactions,
    agreement,
    freshness: adapter.assessFreshness(quarters, asOf),
    adapter: {
      countryCode: adapter.countryCode,
      countryName: adapter.countryName,
      accountingStandard: adapter.accountingStandard,
      currency: ws.currency,
      sourceSystem: result.sourceSystem,
    },
  };
}

function clampAsOf(quarters: QuarterFinancials[], asOfDateISO: string): string {
  try {
    return latestQuarterOnOrBefore(quarters, asOfDateISO).period.endDate;
  } catch {
    // as-of is before all quarters: use the latest period end instead
    const sorted = sortQuarters(quarters);
    const last = sorted[sorted.length - 1];
    return last?.period.endDate ?? asOfDateISO;
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'empresa';
}
