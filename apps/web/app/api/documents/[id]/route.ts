import { getRuntime } from '../../../../lib/server/runtime';

export const runtime = 'nodejs';

/** GET /api/documents/:id → source document for the citation viewer. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const app = await getRuntime();
  const doc = app.dataset.documents.find((d) => d.id === id);
  if (!doc) {
    return Response.json({ error: `document ${id} not found` }, { status: 404 });
  }
  return Response.json(doc);
}
