import { PRODUCT_DISCLAIMER, PRODUCT_NAME, PRODUCT_TAGLINE } from '@covenant/core';
import { getRuntime } from '../../../lib/server/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/meta → branding, provider status and dataset descriptor.
 *  Never exposes secrets — only booleans and public model names. */
export async function GET(): Promise<Response> {
  const app = await getRuntime();
  return Response.json({
    product: { name: PRODUCT_NAME, tagline: PRODUCT_TAGLINE, disclaimer: PRODUCT_DISCLAIMER },
    provider: {
      ...app.provider,
      retriever: app.retriever.kind,
      retrieverReason: app.retrieverReason,
      loopMode: app.loopMode,
    },
    dataset: {
      company: app.dataset.company,
      asOfDate: app.dataset.asOfDate,
      quarters: app.dataset.quarters.length,
      documents: app.dataset.documents.length,
      country: app.dataset.adapter,
      freshness: app.dataset.freshness,
      agreementTitle: app.dataset.agreement?.title ?? null,
    },
  });
}
