/**
 * Provider-agnostic inference interface. The agent layer depends only on
 * this; Vultr Serverless Inference is one implementation. Swapping providers
 * means writing another InferenceClient — nothing upstream changes.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** For role:'tool' — id of the tool call this message answers. */
  toolCallId?: string;
  /** For role:'assistant' — tool calls the model made. */
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  /** JSON-encoded arguments, exactly as the model produced them. */
  arguments: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number };
}

export interface EmbedResponse {
  embeddings: number[][];
  model: string;
}

export interface InferenceClient {
  readonly providerName: string;
  /** True when chat inference is usable (credentials present). */
  isConfigured(): boolean;
  /** True when the embedding path is usable (needs an embedding model too). */
  isEmbedConfigured(): boolean;
  chat(req: ChatRequest): Promise<ChatResponse>;
  embed(input: string[]): Promise<EmbedResponse>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
