import { assessReadiness, createWorkspace, listWorkspaces } from '../../../lib/server/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/company?session=<id> → list the companies created this session,
 *  each with a readiness summary. The base demo case is added by the client. */
export async function GET(req: Request): Promise<Response> {
  const sessionId = new URL(req.url).searchParams.get('session') ?? 'default';
  const companies = listWorkspaces(sessionId).map((ws) => ({
    id: ws.id,
    name: ws.name,
    countryCode: ws.countryCode,
    currency: ws.currency,
    readiness: assessReadiness(ws),
  }));
  return Response.json({ companies });
}

/** POST /api/company {session, name, countryCode?, currency?} → create a new
 *  empty company workspace the user will then upload filings into. */
export async function POST(req: Request): Promise<Response> {
  let body: { session?: string; name?: string; countryCode?: string; currency?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const name = (body.name ?? '').trim();
  if (name.length < 2) {
    return Response.json({ error: 'el nombre de la empresa es obligatorio' }, { status: 400 });
  }
  const sessionId = body.session ?? 'default';
  const ws = createWorkspace(sessionId, { name, countryCode: body.countryCode, currency: body.currency }, nowISO());
  return Response.json({
    company: { id: ws.id, name: ws.name, countryCode: ws.countryCode, currency: ws.currency },
    readiness: assessReadiness(ws),
  });
}

/** Timestamps come from the request, not Date.now(), so the module stays pure
 *  where it can; here in a request handler a wall clock is fine. */
function nowISO(): string {
  return new Date().toISOString();
}
