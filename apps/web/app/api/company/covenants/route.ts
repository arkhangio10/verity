import type { CovenantSpec, RatioKey } from '@covenant/core';
import { assessReadiness, getWorkspace } from '../../../../lib/server/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CovenantInput {
  ratio: RatioKey;
  comparator: 'max' | 'min';
  threshold: number;
}

/** A sensible default covenant package so a user can enable AFTER mode with
 *  one click, then tweak. */
const TEMPLATE: CovenantInput[] = [
  { ratio: 'leverage', comparator: 'max', threshold: 3.5 },
  { ratio: 'dscr', comparator: 'min', threshold: 1.25 },
  { ratio: 'current_ratio', comparator: 'min', threshold: 1.1 },
];

const RATIO_NAMES: Record<RatioKey, string> = {
  leverage: 'Maximum Net Leverage Ratio',
  dscr: 'Minimum Debt Service Coverage Ratio',
  icr: 'Minimum Interest Coverage Ratio',
  current_ratio: 'Minimum Current Ratio',
  fccr: 'Minimum Fixed Charge Coverage Ratio',
};

/** POST /api/company/covenants {session, companyId, covenants?} → set the
 *  covenant thresholds for a workspace (enables AFTER mode). Omit `covenants`
 *  to apply the standard template. */
export async function POST(req: Request): Promise<Response> {
  let body: { session?: string; companyId?: string; covenants?: CovenantInput[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const ws = getWorkspace(body.session ?? 'default', body.companyId ?? '');
  if (!ws) return Response.json({ error: 'empresa no encontrada' }, { status: 404 });

  const inputs = body.covenants && body.covenants.length > 0 ? body.covenants : TEMPLATE;
  if (inputs.some((c) => !Number.isFinite(c.threshold) || c.threshold <= 0)) {
    return Response.json({ error: 'todos los umbrales deben ser números positivos' }, { status: 400 });
  }
  const specs: CovenantSpec[] = inputs.map((c, i) => {
    return {
      id: `ws-cov-${c.ratio}-${i}`,
      name: RATIO_NAMES[c.ratio] ?? c.ratio,
      ratio: c.ratio,
      comparator: c.comparator,
      threshold: c.threshold,
      testBasis: c.ratio === 'current_ratio' ? 'point_in_time' : 'ltm',
      frequency: 'quarterly',
    };
  });
  ws.covenants = specs;

  return Response.json({
    ok: true,
    covenants: specs.map((s) => ({ name: s.name, ratio: s.ratio, comparator: s.comparator, threshold: s.threshold })),
    readiness: assessReadiness(ws),
  });
}
