import { describe, expect, it } from 'vitest';
import { ProviderError, VultrInferenceClient, vultrConfigFromEnv } from '@covenant/providers';

function config(overrides: Partial<ReturnType<typeof vultrConfigFromEnv>> = {}) {
  return {
    apiKey: 'test-key',
    baseUrl: 'https://api.vultrinference.com/v1',
    chatModel: 'test-chat',
    embedModel: 'test-embed',
    timeoutMs: 5000,
    maxRetries: 2,
    ...overrides,
  };
}

type FetchCall = { url: string; init: RequestInit };

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: FetchCall[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift() ?? { status: 500, body: { error: 'exhausted' } };
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { impl, calls };
}

const chatBody = {
  model: 'test-chat',
  choices: [
    {
      message: {
        content: null,
        tool_calls: [
          { id: 'call_1', function: { name: 'ratio_calculator', arguments: '{"ratio":"leverage"}' } },
        ],
      },
      finish_reason: 'tool_calls',
    },
  ],
  usage: { prompt_tokens: 100, completion_tokens: 20 },
};

describe('VultrInferenceClient', () => {
  it('reads config from env with safe defaults and no hard-coded key', () => {
    const cfg = vultrConfigFromEnv({});
    expect(cfg.apiKey).toBe('');
    expect(cfg.baseUrl).toBe('https://api.vultrinference.com/v1');
    const client = new VultrInferenceClient(cfg);
    expect(client.isConfigured()).toBe(false);
    expect(client.isEmbedConfigured()).toBe(false);
  });

  it('shapes OpenAI-compatible chat requests and parses tool calls', async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: chatBody }]);
    const client = new VultrInferenceClient(config(), impl);
    const res = await client.chat({
      messages: [{ role: 'user', content: 'compute leverage' }],
      tools: [{ name: 'ratio_calculator', description: 'calc', parameters: { type: 'object' } }],
    });
    expect(calls[0]!.url).toBe('https://api.vultrinference.com/v1/chat/completions');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-key');
    const sent = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
    expect(sent.model).toBe('test-chat');
    expect(Array.isArray(sent.tools)).toBe(true);
    expect(res.toolCalls[0]).toEqual({
      id: 'call_1',
      name: 'ratio_calculator',
      arguments: '{"ratio":"leverage"}',
    });
    expect(res.usage?.promptTokens).toBe(100);
  });

  it('retries on 5xx then succeeds', async () => {
    const { impl, calls } = fakeFetch([
      { status: 503, body: { error: 'overloaded' } },
      { status: 200, body: chatBody },
    ]);
    const client = new VultrInferenceClient(config(), impl);
    const res = await client.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(calls.length).toBe(2);
    expect(res.finishReason).toBe('tool_calls');
  });

  it('does not retry non-retryable client errors', async () => {
    const { impl, calls } = fakeFetch([{ status: 401, body: { error: 'bad key' } }]);
    const client = new VultrInferenceClient(config(), impl);
    await expect(client.chat({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrowError(
      ProviderError,
    );
    expect(calls.length).toBe(1);
  });

  it('embeds batches and preserves input order', async () => {
    const { impl, calls } = fakeFetch([
      {
        status: 200,
        body: {
          model: 'test-embed',
          data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] },
          ],
        },
      },
    ]);
    const client = new VultrInferenceClient(config(), impl);
    const res = await client.embed(['a', 'b']);
    expect(calls[0]!.url).toContain('/embeddings');
    expect(res.embeddings).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it('refuses to embed without an embedding model configured', async () => {
    const client = new VultrInferenceClient(config({ embedModel: '' }), fakeFetch([]).impl);
    await expect(client.embed(['a'])).rejects.toThrowError(/VULTR_EMBED_MODEL/);
  });
});
