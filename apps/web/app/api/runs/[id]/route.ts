import { runStore } from '../../../../lib/server/runStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/runs/:id → full stored trace for replay after a reload. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const run = runStore.get(id);
  if (!run) {
    return Response.json({ error: `run ${id} not found` }, { status: 404 });
  }
  return Response.json(run);
}
