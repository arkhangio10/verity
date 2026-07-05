import { describe, expect, it } from 'vitest';
import type { CorpusChunk } from '@covenant/core';
import {
  cosineSimilarity,
  foldDiacritics,
  LexicalRetriever,
  selectRetriever,
  VultronRetriever,
} from '@covenant/providers';
import { fakeEmbedClient } from './fakes';

const chunks: CorpusChunk[] = [
  {
    id: 'agr#1.1',
    docId: 'agr',
    docTitle: 'Credit Agreement',
    docKind: 'credit_agreement',
    sectionId: '1.1',
    sectionTitle: 'Covenant EBITDA',
    text: 'Covenant EBITDA means operating profit plus depreciation and amortization plus permitted add-backs.',
  },
  {
    id: 'agr#5.1',
    docId: 'agr',
    docTitle: 'Credit Agreement',
    docKind: 'credit_agreement',
    sectionId: '5.1',
    sectionTitle: 'Maximum Leverage Ratio',
    text: 'The Borrower shall not permit the Net Leverage Ratio to exceed 3.50 to 1.00.',
  },
  {
    id: 'fil#esf',
    docId: 'fil',
    docTitle: 'Estados Financieros 2026-Q1',
    docKind: 'filing',
    sectionId: 'esf',
    sectionTitle: 'Estado de Situación Financiera',
    text: 'Efectivo y Equivalentes al Efectivo 14,000. Pasivos por Arrendamiento 45,700.',
    period: '2026-Q1',
  },
];

describe('LexicalRetriever (BM25 fallback)', () => {
  const retriever = new LexicalRetriever(chunks);

  it('ranks the clause that actually defines the term first', async () => {
    const hits = await retriever.search('definition of covenant EBITDA add-backs');
    expect(hits[0]?.chunk.sectionId).toBe('1.1');
    expect(hits[0]!.score).toBeGreaterThan(0);
  });

  it('matches Spanish text regardless of diacritics', async () => {
    const hits = await retriever.search('estado de situacion financiera efectivo');
    expect(hits[0]?.chunk.id).toBe('fil#esf');
  });

  it('filters by document kind', async () => {
    const hits = await retriever.search('EBITDA leverage efectivo', { docKind: 'filing' });
    expect(hits.every((h) => h.chunk.docKind === 'filing')).toBe(true);
  });

  it('returns nothing for queries with no lexical overlap', async () => {
    const hits = await retriever.search('zzzz unrelated qqqq');
    expect(hits).toEqual([]);
  });

  it('foldDiacritics strips accents but keeps ñ handling stable', () => {
    expect(foldDiacritics('Situación Financiera')).toBe('Situacion Financiera');
  });
});

describe('VultronRetriever (embeddings via inference client)', () => {
  it('indexes the corpus and ranks by cosine similarity', async () => {
    const client = fakeEmbedClient();
    const retriever = new VultronRetriever(client, chunks);
    await retriever.ready();
    const hits = await retriever.search('leverage ratio limit');
    expect(hits[0]?.chunk.sectionId).toBe('5.1');
    // one embed call per corpus batch + one per query
    expect(client.embedCalls.length).toBe(2);
  });

  it('cosineSimilarity behaves on known vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 10);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
    expect(cosineSimilarity([1, 1], [2, 2])).toBeCloseTo(1, 10);
  });
});

describe('selectRetriever factory', () => {
  it('falls back to lexical when no client is configured', async () => {
    const sel = await selectRetriever(chunks, null);
    expect(sel.retriever.kind).toBe('lexical');
    expect(sel.reason).toMatch(/offline/i);
  });

  it('uses vultron when embeddings are configured', async () => {
    const sel = await selectRetriever(chunks, fakeEmbedClient());
    expect(sel.retriever.kind).toBe('vultron');
  });

  it('falls back gracefully when the embedding index fails', async () => {
    const broken = fakeEmbedClient();
    broken.embed = async () => {
      throw new Error('embedding service down');
    };
    const sel = await selectRetriever(chunks, broken);
    expect(sel.retriever.kind).toBe('lexical');
    expect(sel.reason).toMatch(/fallback/);
  });
});
