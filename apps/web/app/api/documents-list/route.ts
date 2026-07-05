import { getRuntime } from '../../../lib/server/runtime';
import { describeCaseDocuments, getUploads } from '../../../lib/server/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/documents-list?session=<id> → the case documents (already ingested)
 *  plus any files uploaded this session, for the Documents panel. */
export async function GET(req: Request): Promise<Response> {
  const app = await getRuntime();
  const sessionId = new URL(req.url).searchParams.get('session') ?? 'default';
  const caseDocs = describeCaseDocuments(app.dataset);
  const uploaded = getUploads(sessionId);
  return Response.json({
    company: app.dataset.company.name,
    country: app.dataset.adapter.countryName,
    accountingStandard: app.dataset.adapter.accountingStandard,
    sourceSystem: app.dataset.adapter.sourceSystem,
    quarters: app.dataset.quarters.length,
    caseDocuments: caseDocs,
    uploadedDocuments: uploaded.map(({ document, filing, ...meta }) => meta),
  });
}
