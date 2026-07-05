import { z } from 'zod';
import type { RetrievalHit } from '@covenant/providers';
import type { RetrievalHitSummary } from '../trace';
import type { ToolDef, ToolOutcome, ToolServices } from '../toolkit';

const argsSchema = z.object({
  query: z.string().min(2),
  k: z.number().int().min(1).max(10).default(4),
  docKind: z.enum(['credit_agreement', 'filing', 'knowledge', 'ledger']).optional(),
  docId: z.string().optional(),
});

type Args = z.infer<typeof argsSchema>;

export interface DocumentRetrieverData {
  query: string;
  retriever: string;
  hits: RetrievalHitSummary[];
}

function snippet(text: string, max = 260): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** document_retriever(query, corpus) → relevant clauses / line items WITH
 *  source locations. The agent calls this repeatedly (definitions, line
 *  items, market standards) — retrieval is a step, not a one-shot. */
export const documentRetrieverTool: ToolDef<Args, DocumentRetrieverData> = {
  name: 'document_retriever',
  description:
    'Search the document corpus (credit agreement clauses, financial-statement filings, knowledge notes, transaction ledger) and return the most relevant sections with document ids, section ids and scores. Use docKind/docId to scope the search. Always cite what this returns.',
  paramsJsonSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural-language or keyword query.' },
      k: { type: 'integer', minimum: 1, maximum: 10 },
      docKind: { type: 'string', enum: ['credit_agreement', 'filing', 'knowledge', 'ledger'] },
      docId: { type: 'string', description: 'Restrict to one document.' },
    },
    required: ['query'],
  },
  argsSchema,
  async run(args, services: ToolServices): Promise<ToolOutcome<DocumentRetrieverData>> {
    const hits: RetrievalHit[] = await services.retriever.search(args.query, {
      k: args.k,
      docKind: args.docKind,
      docId: args.docId,
    });
    const summaries: RetrievalHitSummary[] = hits.map((h) => ({
      docId: h.chunk.docId,
      docTitle: h.chunk.docTitle,
      sectionId: h.chunk.sectionId,
      sectionTitle: h.chunk.sectionTitle,
      score: Number(h.score.toFixed(4)),
      snippet: snippet(h.chunk.text),
    }));
    services.trace.emit({
      type: 'retrieval',
      query: args.query,
      retriever: services.retriever.kind,
      hits: summaries,
    });
    const top = summaries[0];
    return {
      summary: top
        ? `top hit: ${top.docTitle} — ${top.sectionTitle} (score ${top.score})`
        : 'no matching sections',
      factIds: [],
      data: { query: args.query, retriever: services.retriever.kind, hits: summaries },
    };
  },
};
