import { chunksFromDocuments, type RunDataset, type SourceDocument } from '@covenant/core';
import { mapFilingToQuarter, PeruAdapter, type SmvClient, type SmvFilingRecord } from '@covenant/adapters';

/**
 * Session upload store. Keeps user-ingested documents separate from the
 * immutable base case, then merges them into a fresh RunDataset on demand.
 * The base runtime cache is never mutated, so uploads are per-session and the
 * demo case is always pristine.
 */
export interface IngestedDoc {
  docId: string;
  title: string;
  kind: string;
  origin: 'case' | 'uploaded';
  status: 'ingested' | 'partial' | 'failed';
  detail: string;
  sizeLabel?: string;
  /** Full source document (for uploaded ones we merge into the corpus). */
  document?: SourceDocument;
  /** Extra quarters parsed from a financial filing, if any. */
  filing?: SmvFilingRecord;
}

const globalStore = globalThis as unknown as { __verityUploads?: Map<string, IngestedDoc[]> };
const store: Map<string, IngestedDoc[]> = globalStore.__verityUploads ?? new Map();
globalStore.__verityUploads = store;

export function getUploads(sessionId: string): IngestedDoc[] {
  return store.get(sessionId) ?? [];
}

export function addUpload(sessionId: string, doc: IngestedDoc): void {
  const list = store.get(sessionId) ?? [];
  list.push(doc);
  store.set(sessionId, list);
}

export function clearUploads(sessionId: string): void {
  store.delete(sessionId);
}

/** Describe the base case documents as ingested "files" for the panel. The
 *  synthetic filings/agreement/ledger are presented as if freshly ingested,
 *  because that is exactly the pipeline they came through (SMV adapter). */
export function describeCaseDocuments(dataset: RunDataset): IngestedDoc[] {
  const kindLabel: Record<string, string> = {
    filing: 'Estado financiero (SMV/NIIF)',
    credit_agreement: 'Contrato de crédito',
    ledger: 'Libro de transacciones',
    knowledge: 'Nota de referencia',
  };
  const quartersByDoc = new Map(dataset.quarters.map((q) => [`filing-${q.period.label}`, q.period.label]));
  return dataset.documents
    .filter((d) => d.kind !== 'knowledge')
    .map((d) => ({
      docId: d.id,
      title: d.title,
      kind: kindLabel[d.kind] ?? d.kind,
      origin: 'case' as const,
      status: 'ingested' as const,
      detail:
        d.kind === 'filing'
          ? `Normalizado a campos canónicos · período ${quartersByDoc.get(d.id) ?? d.period ?? ''}`
          : d.kind === 'credit_agreement'
            ? `${dataset.agreement?.covenants.length ?? 0} covenants + definiciones verificadas verbatim`
            : d.kind === 'ledger'
              ? `${dataset.transactions.length} movimientos categorizados`
              : 'Ingerido',
      sizeLabel: `${d.sections.length} secciones`,
    }));
}

/** Ingest one uploaded file (PDF text or SMV JSON) through the real
 *  PeruAdapter, returning an IngestedDoc with a mapping-quality status. */
export async function ingestFile(args: {
  filename: string;
  contentType: string;
  text?: string;
  json?: unknown;
  sizeBytes: number;
}): Promise<IngestedDoc> {
  const sizeLabel = args.sizeBytes > 1024 * 1024
    ? `${(args.sizeBytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(args.sizeBytes / 1024))} KB`;
  const docId = `upload-${slug(args.filename)}-${args.sizeBytes}`;

  // Empty in-memory SMV client — the adapter still parses via parseFilingText.
  const noopClient: SmvClient = { sourceName: 'upload', fetchFilings: async () => [] };
  const adapter = new PeruAdapter({ smvClient: noopClient });

  try {
    // ── Path A: SMV-shaped JSON filing ────────────────────────────────────
    if (args.json !== undefined || /json$/i.test(args.filename)) {
      const parsed = typeof args.json === 'string' ? JSON.parse(args.json) : args.json;
      const filings: SmvFilingRecord[] = Array.isArray(parsed) ? parsed : [parsed];
      const first = filings[0];
      if (!first || !first.registros) {
        return failed(docId, args.filename, sizeLabel, 'JSON no tiene el formato de filing SMV (falta "registros").');
      }
      // Validate the mapping by running each filing through the real mapper.
      const warnings: string[] = [];
      for (const f of filings) {
        const mapped = mapFilingToQuarter(f);
        warnings.push(...mapped.warnings);
      }
      return okFiling(docId, args.filename, sizeLabel, filings, warnings, 'JSON SMV');
    }

    // ── Path B: PDF/text filing ──────────────────────────────────────────
    const text = args.text ?? '';
    if (text.trim().length === 0) {
      return failed(docId, args.filename, sizeLabel, 'No se pudo extraer texto (¿PDF escaneado sin texto?).');
    }
    const yearMatch = /20\d{2}/.exec(args.filename);
    const qMatch = /Q([1-4])/i.exec(args.filename);
    const result = await adapter.parseFilingText(text, {
      companyId: 'UPLOAD',
      companyName: args.filename.replace(/\.[a-z]+$/i, ''),
      year: yearMatch ? Number(yearMatch[0]) : 2026,
      quarter: (qMatch ? Number(qMatch[1]) : 1) as 1 | 2 | 3 | 4,
      docId,
    });
    const mappedLines = result.quarters[0]
      ? Object.values(result.quarters[0].balance).filter(Boolean).length +
        Object.values(result.quarters[0].income).filter(Boolean).length +
        Object.values(result.quarters[0].cashflow).filter(Boolean).length
      : 0;
    const status: IngestedDoc['status'] = mappedLines >= 8 ? 'ingested' : mappedLines > 0 ? 'partial' : 'failed';
    return {
      docId,
      title: args.filename,
      kind: 'Estado financiero (subido)',
      origin: 'uploaded',
      status,
      detail:
        status === 'failed'
          ? 'No se reconocieron líneas de estados financieros en el texto.'
          : `${mappedLines} líneas mapeadas a campos canónicos${result.warnings.length ? ` · ${result.warnings.length} advertencia(s)` : ''}`,
      sizeLabel,
      document: renderUploadDoc(docId, args.filename, text),
    };
  } catch (err) {
    return failed(docId, args.filename, sizeLabel, err instanceof Error ? err.message : String(err));
  }
}

function okFiling(
  docId: string,
  filename: string,
  sizeLabel: string,
  filings: SmvFilingRecord[],
  warnings: string[],
  kind: string,
): IngestedDoc {
  return {
    docId,
    title: filename,
    kind: `Estado financiero (${kind})`,
    origin: 'uploaded',
    status: warnings.length > 5 ? 'partial' : 'ingested',
    detail: `${filings.length} filing(s) · ${filings.reduce((n, f) => n + f.registros.length, 0)} líneas${warnings.length ? ` · ${warnings.length} advertencia(s)` : ''}`,
    sizeLabel,
    filing: filings[0],
  };
}

function failed(docId: string, filename: string, sizeLabel: string, detail: string): IngestedDoc {
  return { docId, title: filename, kind: 'Archivo subido', origin: 'uploaded', status: 'failed', detail, sizeLabel };
}

function renderUploadDoc(docId: string, filename: string, text: string): SourceDocument {
  const clean = text.slice(0, 20000);
  return {
    id: docId,
    title: filename,
    kind: 'filing',
    language: 'es',
    sections: [{ id: 'contenido', title: 'Contenido extraído', text: clean }],
  };
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/\.[a-z]+$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

/** Merge uploaded documents into a base dataset (fresh corpus). Uploaded docs
 *  become citable sources; SMV-JSON uploads also contribute their quarters. */
export function mergeUploads(base: RunDataset, uploads: IngestedDoc[]): RunDataset {
  const usable = uploads.filter((u) => u.status !== 'failed');
  if (usable.length === 0) return base;
  const extraDocs = usable.flatMap((u) => (u.document ? [u.document] : []));
  const documents = [...base.documents, ...extraDocs];
  return {
    ...base,
    documents,
    corpus: chunksFromDocuments(documents),
  };
}
