import type { CorpusChunk, DocumentKind } from '@covenant/core';
import { ProviderError, type InferenceClient } from './types';

export interface RetrievalHit {
  chunk: CorpusChunk;
  score: number;
}

export interface SearchOptions {
  k?: number;
  docKind?: DocumentKind;
  docId?: string;
}

/** Document retrieval behind one interface: VultronRetriever (embeddings via
 *  Vultr Serverless Inference) for semantic search, LexicalRetriever (BM25)
 *  as the offline/deterministic fallback. */
export interface Retriever {
  readonly kind: 'vultron' | 'lexical';
  /** Build the index (embeds the corpus for vultron). Idempotent. */
  ready(): Promise<void>;
  search(query: string, opts?: SearchOptions): Promise<RetrievalHit[]>;
}

const DEFAULT_K = 4;

// ── Lexical (BM25) ───────────────────────────────────────────────────────────

/** Fold diacritics so Spanish queries match regardless of accents
 *  ("situacion" ⇢ "Situación"). */
export function foldDiacritics(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function tokenize(s: string): string[] {
  return foldDiacritics(s.toLowerCase())
    .split(/[^a-z0-9ñ]+/i)
    .filter((t) => t.length >= 2);
}

interface IndexedChunk {
  chunk: CorpusChunk;
  termFreq: Map<string, number>;
  length: number;
}

const BM25_K1 = 1.5;
const BM25_B = 0.75;

export class LexicalRetriever implements Retriever {
  readonly kind = 'lexical' as const;
  private readonly indexed: IndexedChunk[];
  private readonly docFreq = new Map<string, number>();
  private readonly avgLength: number;

  constructor(chunks: CorpusChunk[]) {
    this.indexed = chunks.map((chunk) => {
      const terms = tokenize(`${chunk.docTitle} ${chunk.sectionTitle} ${chunk.text}`);
      const termFreq = new Map<string, number>();
      for (const t of terms) termFreq.set(t, (termFreq.get(t) ?? 0) + 1);
      return { chunk, termFreq, length: terms.length };
    });
    for (const ic of this.indexed) {
      for (const term of ic.termFreq.keys()) {
        this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
      }
    }
    this.avgLength =
      this.indexed.reduce((acc, ic) => acc + ic.length, 0) / Math.max(1, this.indexed.length);
  }

  async ready(): Promise<void> {
    // index built in constructor
  }

  async search(query: string, opts: SearchOptions = {}): Promise<RetrievalHit[]> {
    const queryTerms = tokenize(query);
    const n = this.indexed.length;
    const scored = this.indexed
      .filter((ic) => matchesFilter(ic.chunk, opts))
      .map((ic) => {
        let score = 0;
        for (const term of queryTerms) {
          const tf = ic.termFreq.get(term) ?? 0;
          if (tf === 0) continue;
          const df = this.docFreq.get(term) ?? 0;
          const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
          const norm = tf + BM25_K1 * (1 - BM25_B + (BM25_B * ic.length) / this.avgLength);
          score += idf * ((tf * (BM25_K1 + 1)) / norm);
        }
        return { chunk: ic.chunk, score };
      })
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, opts.k ?? DEFAULT_K);
  }
}

// ── Vultron (embeddings via Vultr Serverless Inference) ─────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

const EMBED_BATCH = 16;

export class VultronRetriever implements Retriever {
  readonly kind = 'vultron' as const;
  private vectors: number[][] | null = null;
  private indexing: Promise<void> | null = null;

  constructor(
    private readonly client: InferenceClient,
    private readonly chunks: CorpusChunk[],
  ) {}

  ready(): Promise<void> {
    if (!this.indexing) this.indexing = this.buildIndex();
    return this.indexing;
  }

  private async buildIndex(): Promise<void> {
    if (!this.client.isEmbedConfigured()) {
      throw new ProviderError('VultronRetriever requires an embedding-configured inference client');
    }
    const vectors: number[][] = [];
    for (let i = 0; i < this.chunks.length; i += EMBED_BATCH) {
      const batch = this.chunks.slice(i, i + EMBED_BATCH);
      const res = await this.client.embed(batch.map(chunkEmbeddingText));
      vectors.push(...res.embeddings);
    }
    this.vectors = vectors;
  }

  async search(query: string, opts: SearchOptions = {}): Promise<RetrievalHit[]> {
    await this.ready();
    if (!this.vectors) throw new ProviderError('VultronRetriever index unavailable');
    const [queryVector] = (await this.client.embed([query])).embeddings;
    if (!queryVector) throw new ProviderError('empty query embedding');
    const hits: RetrievalHit[] = [];
    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i];
      const vector = this.vectors[i];
      if (!chunk || !vector) continue;
      if (!matchesFilter(chunk, opts)) continue;
      hits.push({ chunk, score: cosineSimilarity(queryVector, vector) });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, opts.k ?? DEFAULT_K);
  }
}

function chunkEmbeddingText(chunk: CorpusChunk): string {
  return `${chunk.docTitle} — ${chunk.sectionTitle}\n${chunk.text}`;
}

function matchesFilter(chunk: CorpusChunk, opts: SearchOptions): boolean {
  if (opts.docKind && chunk.docKind !== opts.docKind) return false;
  if (opts.docId && chunk.docId !== opts.docId) return false;
  return true;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export interface RetrieverSelection {
  retriever: Retriever;
  /** Why this retriever was selected — surfaced in the UI provider badge. */
  reason: string;
}

/** Prefer semantic retrieval through Vultr when it is configured and its
 *  index builds; otherwise fall back to the deterministic lexical index so
 *  the product works with zero external dependencies. */
export async function selectRetriever(
  chunks: CorpusChunk[],
  client: InferenceClient | null,
): Promise<RetrieverSelection> {
  if (client?.isEmbedConfigured()) {
    const vultron = new VultronRetriever(client, chunks);
    try {
      await vultron.ready();
      return { retriever: vultron, reason: 'VultronRetriever via Vultr Serverless Inference embeddings' };
    } catch (err) {
      return {
        retriever: new LexicalRetriever(chunks),
        reason: `Vultron index failed (${err instanceof Error ? err.message : String(err)}); using lexical BM25 fallback`,
      };
    }
  }
  return {
    retriever: new LexicalRetriever(chunks),
    reason: client?.isConfigured()
      ? 'no embedding model configured (set VULTR_EMBED_MODEL); using lexical BM25 fallback'
      : 'offline mode: lexical BM25 retriever over the bundled corpus',
  };
}
