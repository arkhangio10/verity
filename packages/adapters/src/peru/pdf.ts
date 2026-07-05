import type { SmvStatementRecord } from './smv';
import { foldEs, type Estado } from './terms';

/**
 * Secondary ingestion path: audited annual reports / notes arrive as PDFs.
 * We extract text (pdf-parse, loaded lazily so the dependency is optional at
 * runtime) and parse statement tables into the same SmvStatementRecord shape
 * the primary path uses — one mapping pipeline for both.
 */
export interface ParsedFilingText {
  records: SmvStatementRecord[];
  warnings: string[];
}

const HEADER_PATTERNS: { estado: Estado; needle: string }[] = [
  { estado: 'ESF', needle: 'estado de situacion financiera' },
  { estado: 'ER', needle: 'estado de resultados' },
  { estado: 'EFE', needle: 'estado de flujos de efectivo' },
];

/** Lines look like "Efectivo y Equivalentes al Efectivo        14,000" or
 *  "Dividendos Pagados ............ (45,000)". Parentheses mean negative. */
const LINE_RE = /^(.*?)[\s.·]{2,}\(?(-?[\d][\d,]*(?:\.\d+)?)\)?\s*$/;

function parseAmount(raw: string, negative: boolean): number {
  const value = Number(raw.replace(/,/g, ''));
  return negative ? -value : value;
}

export function parseFilingTextToRecords(text: string): ParsedFilingText {
  const records: SmvStatementRecord[] = [];
  const warnings: string[] = [];
  let currentEstado: Estado | null = null;
  let lineNo = 0;
  let counter = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    lineNo += 1;
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const folded = foldEs(line);
    const header = HEADER_PATTERNS.find((h) => folded.includes(h.needle));
    if (header) {
      currentEstado = header.estado;
      continue;
    }
    if (!currentEstado) continue;

    const match = LINE_RE.exec(line);
    if (!match) continue;
    const [, label, amount] = match;
    if (!label || !amount) continue;
    const cleanLabel = label.replace(/[.·\s]+$/, '').trim();
    if (cleanLabel.length < 3) continue;
    counter += 1;
    records.push({
      estado: currentEstado,
      cuenta: `PDF-L${String(lineNo).padStart(4, '0')}`,
      descripcion: cleanLabel,
      monto: parseAmount(amount, rawLine.includes(`(${amount})`)),
    });
  }

  if (records.length === 0) {
    warnings.push('no statement lines recognized — is this a scanned (image-only) PDF?');
  } else if (counter < 10) {
    warnings.push('few statement lines recognized; verify the extraction manually');
  }
  return { records, warnings };
}

/** Extract text from a PDF buffer. pdf-parse is imported lazily so
 *  environments without it fail with a clear message instead of at startup. */
export async function extractPdfText(buffer: Uint8Array): Promise<string> {
  let pdfParse: (data: Buffer) => Promise<{ text: string }>;
  try {
    const mod = (await import('pdf-parse/lib/pdf-parse.js')) as unknown as {
      default?: (data: Buffer) => Promise<{ text: string }>;
    };
    pdfParse = mod.default ?? (mod as unknown as (data: Buffer) => Promise<{ text: string }>);
  } catch (err) {
    throw new Error(
      `PDF extraction requires the optional "pdf-parse" dependency (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  const result = await pdfParse(Buffer.from(buffer));
  return result.text;
}
