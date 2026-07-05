import type { ChatMessage, InferenceClient, ToolSpec } from '@covenant/providers';
import { numberGuard, parseDraft, type OutputSection } from './compose';
import type { Planner } from './planner';
import {
  executeTool,
  toolSpecsForLlm,
  ToolError,
  type ToolRegistry,
  type ToolServices,
} from './toolkit';

export class LlmLoopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmLoopError';
  }
}

const SUBMIT_TOOL: ToolSpec = {
  name: 'submit_report',
  description:
    'Submit the final report once every needed tool has been called. Sections are prose; reference numeric facts strictly as {{fact:ID}} tokens (IDs come from tool results) and cite documents as [[cite:docId#sectionId]]. Never write digits directly.',
  parameters: {
    type: 'object',
    properties: {
      sections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            heading: { type: 'string' },
            prose: { type: 'string' },
          },
          required: ['id', 'heading', 'prose'],
        },
        minItems: 2,
      },
    },
    required: ['sections'],
  },
};

function missionPrompt(services: ToolServices): string {
  const { mode, dataset } = services;
  const covenantList =
    dataset.agreement?.covenants
      .map((c) => `- ${c.id}: ${c.name} (${c.ratio}, ${c.comparator} ${c.threshold})`)
      .join('\n') ?? '(none — design mode)';
  return [
    `You are a covenant ${mode === 'after' ? 'monitoring' : 'design'} agent for ${dataset.company.name} (${dataset.adapter.countryName}).`,
    mode === 'after'
      ? 'Mission: verify each covenant against the executed agreement, measure headroom, detect drift toward a breach, find the likely cause in the transaction ledger, stress forward risk, then submit an escalation memo.'
      : 'Mission: analyze the historical financials (volatility, stress) and propose a covenant package with justified thresholds, then submit a term sheet.',
    `Test period: ${services.asOfQuarter}. Covenants:\n${covenantList}`,
    'RULES:',
    '- All numbers come from tools. NEVER compute or invent numbers.',
    '- Retrieve supporting clauses/documents before relying on them; cite them.',
    '- Call tools step by step; then call submit_report exactly once.',
    '- In prose, numbers may appear ONLY as {{fact:ID}} tokens from tool factIds.',
  ].join('\n');
}

/**
 * Fully model-driven ReAct loop (AGENT_LOOP_MODE=model): the LLM chooses
 * which tools to call and when to stop. Every call still flows through
 * executeTool (validation + trace), all math stays in the engine, and the
 * final prose passes the same fact/number guards. Falls back to the scripted
 * orchestrator on any failure.
 */
export async function runModelLoop(
  services: ToolServices,
  _planner: Planner,
  inference: InferenceClient,
  registry: ToolRegistry,
): Promise<OutputSection[]> {
  const tools = [...toolSpecsForLlm(registry), SUBMIT_TOOL];
  const messages: ChatMessage[] = [
    { role: 'system', content: missionPrompt(services) },
    { role: 'user', content: 'Begin. Plan briefly, then call tools.' },
  ];

  for (let iteration = 0; iteration < services.policy.maxLlmToolIterations; iteration++) {
    services.trace.checkAborted();
    const res = await inference.chat({ messages, tools, temperature: 0.2, maxTokens: 1200 });
    if (res.content && res.content.trim().length > 0) {
      services.trace.note(res.content.trim().slice(0, 500), 'llm');
    }
    if (res.toolCalls.length === 0) {
      messages.push({ role: 'assistant', content: res.content ?? '' });
      messages.push({
        role: 'user',
        content: 'Continue: call the next tool, or submit_report if the analysis is complete.',
      });
      continue;
    }
    messages.push({ role: 'assistant', content: res.content ?? '', toolCalls: res.toolCalls });

    for (const call of res.toolCalls) {
      let args: unknown = {};
      try {
        args = call.arguments ? JSON.parse(call.arguments) : {};
      } catch {
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          content: JSON.stringify({ error: 'arguments were not valid JSON' }),
        });
        continue;
      }

      if (call.name === SUBMIT_TOOL.name) {
        return finalizeReport(args, services);
      }

      try {
        const outcome = await executeTool(registry, call.name, args, services);
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          content: truncate(
            JSON.stringify({ summary: outcome.summary, factIds: outcome.factIds, data: outcome.data }),
            4000,
          ),
        });
      } catch (err) {
        const message = err instanceof ToolError ? err.message : String(err);
        messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify({ error: message }) });
      }
    }
  }
  throw new LlmLoopError('model loop hit the iteration cap without submitting a report');
}

function finalizeReport(args: unknown, services: ToolServices): OutputSection[] {
  const sections = (args as { sections?: { id?: string; heading?: string; prose?: string }[] }).sections;
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new LlmLoopError('submit_report carried no sections');
  }
  return sections.map((raw, i) => {
    const parsed = parseDraft(raw.prose ?? '', services.facts);
    if (parsed.unknownFactIds.length > 0) {
      throw new LlmLoopError(`report referenced unknown facts: ${parsed.unknownFactIds.join(', ')}`);
    }
    const guard = numberGuard(parsed.spans);
    if (!guard.ok) {
      throw new LlmLoopError(`report contained raw numbers (${guard.offending.join(', ')})`);
    }
    return {
      id: raw.id ?? `section-${i}`,
      heading: raw.heading ?? `Section ${i + 1}`,
      blocks: [{ kind: 'paragraph', spans: parsed.spans }],
      draftedBy: 'llm' as const,
    };
  });
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
