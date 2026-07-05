import {
  ProviderError,
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  type EmbedResponse,
  type InferenceClient,
  type ToolCall,
} from './types';

export interface VultrConfig {
  apiKey: string;
  baseUrl: string;
  chatModel: string;
  embedModel: string;
  timeoutMs: number;
  maxRetries: number;
}

export const VULTR_DEFAULT_BASE_URL = 'https://api.vultrinference.com/v1';

export function vultrConfigFromEnv(env: Record<string, string | undefined> = process.env): VultrConfig {
  return {
    apiKey: env.VULTR_API_KEY ?? '',
    baseUrl: (env.VULTR_INFERENCE_BASE_URL ?? VULTR_DEFAULT_BASE_URL).replace(/\/+$/, ''),
    chatModel: env.VULTR_CHAT_MODEL ?? 'llama-3.3-70b-instruct-fp8',
    embedModel: env.VULTR_EMBED_MODEL ?? '',
    timeoutMs: Number(env.VULTR_TIMEOUT_MS ?? 60_000),
    maxRetries: 2,
  };
}

type FetchLike = typeof fetch;

interface OpenAiChatChoice {
  message?: {
    content?: string | null;
    tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
  };
  finish_reason?: string;
}

/**
 * Vultr Serverless Inference client (OpenAI-compatible endpoint). Credentials
 * come from the environment; nothing is hard-coded and the key is never
 * logged. Retries transparently on 429/5xx with jittered backoff.
 */
export class VultrInferenceClient implements InferenceClient {
  readonly providerName = 'vultr-serverless-inference';

  constructor(
    private readonly config: VultrConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  isConfigured(): boolean {
    return this.config.apiKey.length > 0 && this.config.chatModel.length > 0;
  }

  isEmbedConfigured(): boolean {
    return this.config.apiKey.length > 0 && this.config.embedModel.length > 0;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: this.config.chatModel,
      messages: req.messages.map(toOpenAiMessage),
      temperature: req.temperature ?? 0.2,
      max_tokens: req.maxTokens ?? 2048,
    };
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    const json = await this.post('/chat/completions', body);
    const choice = (json as { choices?: OpenAiChatChoice[] }).choices?.[0];
    if (!choice) throw new ProviderError('Vultr chat response had no choices');
    const toolCalls: ToolCall[] = (choice.message?.tool_calls ?? []).map((tc, i) => ({
      id: tc.id ?? `call_${i}`,
      name: tc.function?.name ?? '',
      arguments: tc.function?.arguments ?? '{}',
    }));
    const usage = (json as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
    return {
      content: choice.message?.content ?? null,
      toolCalls,
      finishReason: choice.finish_reason ?? 'stop',
      model: (json as { model?: string }).model ?? this.config.chatModel,
      usage: usage
        ? { promptTokens: usage.prompt_tokens ?? 0, completionTokens: usage.completion_tokens ?? 0 }
        : undefined,
    };
  }

  async embed(input: string[]): Promise<EmbedResponse> {
    if (!this.isEmbedConfigured()) {
      throw new ProviderError('Vultr embedding model not configured (set VULTR_EMBED_MODEL)');
    }
    const json = await this.post('/embeddings', { model: this.config.embedModel, input });
    const data = (json as { data?: { embedding?: number[]; index?: number }[] }).data;
    if (!data || data.length !== input.length) {
      throw new ProviderError('Vultr embeddings response malformed or incomplete');
    }
    const sorted = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return {
      embeddings: sorted.map((d) => d.embedding ?? []),
      model: (json as { model?: string }).model ?? this.config.embedModel,
    };
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    if (!this.config.apiKey) {
      throw new ProviderError('VULTR_API_KEY is not set; live inference unavailable');
    }
    let lastError: ProviderError | null = null;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (attempt > 0) await sleep(250 * 2 ** attempt * (0.5 + Math.random()));
      try {
        const res = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.config.timeoutMs),
        });
        if (!res.ok) {
          const retryable = res.status === 429 || res.status >= 500;
          const text = await res.text().catch(() => '');
          lastError = new ProviderError(
            `Vultr inference ${path} failed: HTTP ${res.status} ${truncate(text, 300)}`,
            res.status,
            retryable,
          );
          if (!retryable) throw lastError;
          continue;
        }
        return (await res.json()) as unknown;
      } catch (err) {
        if (err instanceof ProviderError) {
          if (!err.retryable) throw err;
          lastError = err;
          continue;
        }
        // network / timeout errors are retryable
        lastError = new ProviderError(
          `Vultr inference ${path} network error: ${err instanceof Error ? err.message : String(err)}`,
          undefined,
          true,
        );
      }
    }
    throw lastError ?? new ProviderError('Vultr inference failed');
  }
}

function toOpenAiMessage(m: ChatMessage): Record<string, unknown> {
  const base: Record<string, unknown> = { role: m.role, content: m.content };
  if (m.role === 'tool' && m.toolCallId) base.tool_call_id = m.toolCallId;
  if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
    base.tool_calls = m.toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: tc.arguments },
    }));
  }
  return base;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
