import { extractPdfText, mapFilingToQuarter, parseFilingTextToRecords, type SmvFilingRecord } from '@covenant/adapters';
import { addFilingToWorkspace, assessReadiness, getWorkspace } from '../../../../lib/server/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 8 * 1024 * 1024;

/** POST /api/company/filing (multipart: session, companyId, period?, file)
 *  Ingests one quarter into a user-created company workspace via the real
 *  Peru adapter, then returns the updated readiness. */
export async function POST(req: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: 'se esperaba multipart/form-data' }, { status: 400 });
  }
  const sessionId = String(form.get('session') ?? 'default');
  const companyId = String(form.get('companyId') ?? '');
  const period = String(form.get('period') ?? ''); // optional "2026-Q1"
  const file = form.get('file');

  const ws = getWorkspace(sessionId, companyId);
  if (!ws) return Response.json({ error: 'empresa no encontrada' }, { status: 404 });
  if (!(file instanceof File)) return Response.json({ error: 'no se recibió archivo' }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: 'archivo demasiado grande' }, { status: 413 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file.name || 'archivo';
  const isPdf = /pdf$/i.test(name) || file.type === 'application/pdf';
  const isJson = /json$/i.test(name) || file.type === 'application/json';

  try {
    const parsedPeriod = parsePeriod(period || name);
    let filing: SmvFilingRecord;
    let warnings: string[] = [];

    if (isJson) {
      const raw = JSON.parse(new TextDecoder().decode(bytes)) as SmvFilingRecord | SmvFilingRecord[];
      const one = Array.isArray(raw) ? raw[0] : raw;
      if (!one || !one.registros) {
        return Response.json({ error: 'JSON sin formato de filing SMV (falta "registros")' }, { status: 422 });
      }
      filing = normalizeFiling(one, parsedPeriod, ws.currency);
    } else {
      const text = isPdf ? await extractPdfText(bytes) : new TextDecoder().decode(bytes);
      const parsed = parseFilingTextToRecords(text);
      if (parsed.records.length === 0) {
        return Response.json(
          { error: 'no se reconocieron líneas de estados financieros (¿PDF escaneado?)' },
          { status: 422 },
        );
      }
      filing = {
        rmvCode: ws.id,
        razonSocial: ws.name,
        anio: parsedPeriod.year,
        trimestre: parsedPeriod.quarter,
        moneda: ws.currency === 'USD' ? 'USD' : 'PEN',
        escala: 1000,
        fechaPresentacion: `${parsedPeriod.year}-12-31`,
        registros: parsed.records,
      };
      warnings = parsed.warnings;
    }

    // validate mapping quality before accepting
    const mapped = mapFilingToQuarter(filing);
    warnings.push(...mapped.warnings);
    const mappedFields =
      Object.values(mapped.quarter.balance).filter(Boolean).length +
      Object.values(mapped.quarter.income).filter(Boolean).length +
      Object.values(mapped.quarter.cashflow).filter(Boolean).length;

    if (mappedFields < 8) {
      return Response.json(
        {
          error: `mapeo incompleto: solo ${mappedFields} campos reconocidos (se necesitan ≥8). Revisa el formato.`,
          warnings: warnings.slice(0, 6),
        },
        { status: 422 },
      );
    }

    addFilingToWorkspace(ws, filing);
    return Response.json({
      ok: true,
      period: `${filing.anio}-Q${filing.trimestre}`,
      mappedFields,
      warnings: warnings.slice(0, 6),
      readiness: assessReadiness(ws),
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}

function parsePeriod(hint: string): { year: number; quarter: 1 | 2 | 3 | 4 } {
  const y = /20\d{2}/.exec(hint);
  const q = /Q([1-4])/i.exec(hint);
  return { year: y ? Number(y[0]) : 2026, quarter: (q ? Number(q[1]) : 1) as 1 | 2 | 3 | 4 };
}

function normalizeFiling(
  f: SmvFilingRecord,
  period: { year: number; quarter: 1 | 2 | 3 | 4 },
  currency: string,
): SmvFilingRecord {
  return {
    ...f,
    anio: f.anio || period.year,
    trimestre: (f.trimestre || period.quarter) as 1 | 2 | 3 | 4,
    moneda: f.moneda || (currency === 'USD' ? 'USD' : 'PEN'),
    escala: f.escala || 1000,
    fechaPresentacion: f.fechaPresentacion || `${f.anio || period.year}-12-31`,
  };
}
