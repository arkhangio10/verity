import type {
  ChatRequest,
  ChatResponse,
  EmbedResponse,
  InferenceClient,
} from '@covenant/providers';

/** Deterministic bag-of-words embedding over a tiny vocabulary — enough to
 *  make cosine ranking meaningful in tests without a real model. */
const VOCAB = [
  'ebitda', 'covenant', 'leverage', 'ratio', 'net', 'add-backs', 'depreciation',
  'efectivo', 'situacion', 'financiera', 'arrendamiento', 'exceed', 'borrower',
  'definition', 'limit', 'operating',
];

function bagOfWords(text: string): number[] {
  const lower = text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return VOCAB.map((term) => {
    const matches = lower.split(term).length - 1;
    return matches;
  });
}

export interface FakeEmbedClient extends InferenceClient {
  embedCalls: string[][];
  chatCalls: ChatRequest[];
  nextChatResponses: ChatResponse[];
}

export function fakeEmbedClient(): FakeEmbedClient {
  const client: FakeEmbedClient = {
    providerName: 'fake',
    embedCalls: [],
    chatCalls: [],
    nextChatResponses: [],
    isConfigured: () => true,
    isEmbedConfigured: () => true,
    async embed(input: string[]): Promise<EmbedResponse> {
      client.embedCalls.push(input);
      return { embeddings: input.map(bagOfWords), model: 'fake-embed' };
    },
    async chat(req: ChatRequest): Promise<ChatResponse> {
      client.chatCalls.push(req);
      const next = client.nextChatResponses.shift();
      if (next) return next;
      return { content: 'ok', toolCalls: [], finishReason: 'stop', model: 'fake-chat' };
    },
  };
  return client;
}
