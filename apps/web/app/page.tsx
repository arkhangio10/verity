import { PRODUCT_DISCLAIMER, PRODUCT_NAME, PRODUCT_TAGLINE } from '@covenant/core';
import { AccessGate } from '../components/AccessGate';
import { getRuntime } from '../lib/server/runtime';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const app = await getRuntime();
  return (
    <AccessGate
      meta={{
        product: { name: PRODUCT_NAME, tagline: PRODUCT_TAGLINE, disclaimer: PRODUCT_DISCLAIMER },
        provider: {
          name: app.provider.name,
          configured: app.provider.configured,
          chatModel: app.provider.chatModel,
          retriever: app.retriever.kind,
          retrieverReason: app.retrieverReason,
          loopMode: app.loopMode,
        },
        company: {
          name: app.dataset.company.name,
          ticker: app.dataset.company.ticker ?? null,
          country: app.dataset.adapter.countryName,
          accountingStandard: app.dataset.adapter.accountingStandard,
          currency: app.dataset.adapter.currency,
          sourceSystem: app.dataset.adapter.sourceSystem,
        },
        asOfDate: app.dataset.asOfDate,
        quarters: app.dataset.quarters.length,
        agreementTitle: app.dataset.agreement?.title ?? null,
      }}
    />
  );
}
