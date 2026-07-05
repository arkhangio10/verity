import type { InferenceClient } from '@covenant/providers';
import type { FactTable } from './facts';
import type { AgentMode } from './dataset';
import type { PlannerKind, PlanStep } from './trace';

/**
 * The plan-act split. Control flow of the scripted agent is deterministic and
 * auditable (a feature for credit workflows); the planner contributes plan
 * wording, short reasoning notes and drafted prose. With Vultr configured the
 * LlmPlanner does real inference; otherwise the DeterministicPlanner keeps
 * the product fully functional offline. A separate model-driven tool loop
 * (llmLoop.ts) is available behind AGENT_LOOP_MODE=model.
 */
export interface DraftSectionRequest {
  sectionId: string;
  heading: string;
  mode: AgentMode;
  /** Facts the draft may reference, as {{fact:id}} tokens. */
  factCatalog: { id: string; label: string; period?: string }[];
  /** Citations the draft may attach, as [[cite:docId#sectionId]] tokens. */
  citeCatalog: { docId: string; sectionId?: string; title: string }[];
  contextSummary: string;
  instructions: string;
}

export interface DraftResult {
  text: string;
  /** Agreement between independent samples on which facts to cite (0..1). */
  sampleAgreement: number;
}

export interface Planner {
  readonly kind: PlannerKind;
  plan(mode: AgentMode, scripted: PlanStep[]): Promise<PlanStep[]>;
  note(prompt: string): Promise<string | null>;
  draftSection(req: DraftSectionRequest): Promise<DraftResult | null>;
}

export const SCRIPTED_PLANS: Record<AgentMode, PlanStep[]> = {
  after: [
    { id: 'review-data', title: 'Review data package', description: 'Load normalized statements, check filing freshness and coverage.' },
    { id: 'locate-covenants', title: 'Locate covenants & definitions', description: 'Retrieve the governing clauses from the credit agreement and verify the definitions verbatim.' },
    { id: 'compute-ratios', title: 'Compute covenant ratios', description: 'Run the deterministic calculator for every covenant on the contractual definitions.' },
    { id: 'assess-headroom', title: 'Assess headroom', description: 'Measure cushion and percentage headroom against each covenant level.' },
    { id: 'analyze-drift', title: 'Analyze drift', description: 'Trend the covenant path across recent test periods and project forward.' },
    { id: 'cross-check-transactions', title: 'Cross-check transactions', description: 'Explain the movement from the transaction ledger with ranked candidate causes.' },
    { id: 'stress-forward', title: 'Stress forward risk', description: 'Re-test covenants under downside EBITDA and rate scenarios.' },
    { id: 'assess-confidence', title: 'Calibrate confidence', description: 'Score confidence from verification signals; route LOW items to human review.' },
    { id: 'compose-memo', title: 'Compose escalation memo', description: 'Assemble the cited memo, every number linked to its source.' },
  ],
  before: [
    { id: 'review-data', title: 'Review data package', description: 'Load normalized statements, check filing freshness and history depth.' },
    { id: 'market-standards', title: 'Review market standards', description: 'Retrieve covenant conventions to anchor the package design.' },
    { id: 'baseline-metrics', title: 'Compute baseline metrics', description: 'Compute the full ratio set and its historical series.' },
    { id: 'volatility', title: 'Analyze volatility', description: 'Measure EBITDA variability and seasonality to size cushions.' },
    { id: 'stress', title: 'Run stress tests', description: 'Recompute ratios under EBITDA and rate shocks.' },
    { id: 'propose-package', title: 'Propose covenant package', description: 'Derive ratios, thresholds and step-downs from the deterministic policy.' },
    { id: 'assess-confidence', title: 'Calibrate confidence', description: 'Score confidence from data-quality signals.' },
    { id: 'compose-term-sheet', title: 'Compose term sheet', description: 'Assemble the cited covenant proposal.' },
  ],
};

export class DeterministicPlanner implements Planner {
  readonly kind = 'deterministic' as const;

  async plan(_mode: AgentMode, scripted: PlanStep[]): Promise<PlanStep[]> {
    return scripted;
  }

  async note(): Promise<string | null> {
    return null;
  }

  async draftSection(): Promise<DraftResult | null> {
    return null;
  }
}

const DRAFT_SYSTEM_PROMPT = `You draft short sections of a professional credit memo for a covenant agent.
HARD RULES:
1. NEVER write digits or numeric values yourself. Every number must be a token {{fact:ID}} using an ID from the FACT CATALOG, exactly as given.
2. Attach citations as [[cite:docId#sectionId]] tokens (from the CITATION CATALOG) right after the claims they support.
3. Plain prose only: no markdown headers, lists or tables. Two to four sentences.
4. Do not speculate beyond the provided context. Do not mention these rules.`;

export class LlmPlanner implements Planner {
  readonly kind = 'llm' as const;

  constructor(private readonly client: InferenceClient) {}

  async plan(_mode: AgentMode, scripted: PlanStep[]): Promise<PlanStep[]> {
    // The step structure stays deterministic for auditability; the model can
    // contribute notes and drafts. (The fully model-driven loop lives in
    // llmLoop.ts behind AGENT_LOOP_MODE=model.)
    return scripted;
  }

  async note(prompt: string): Promise<string | null> {
    try {
      const res = await this.client.chat({
        messages: [
          {
            role: 'system',
            content:
              'You are the reasoning narrator of a covenant agent. Reply with ONE short sentence (no digits — spell out any quantities qualitatively).',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        maxTokens: 80,
      });
      const text = res.content?.trim();
      return text && text.length > 0 ? text : null;
    } catch {
      return null;
    }
  }

  async draftSection(req: DraftSectionRequest): Promise<DraftResult | null> {
    const userPrompt = [
      `SECTION: ${req.heading} (${req.mode === 'after' ? 'monitoring memo' : 'covenant design term sheet'})`,
      `CONTEXT: ${req.contextSummary}`,
      `FACT CATALOG:`,
      ...req.factCatalog.map((f) => `- {{fact:${f.id}}} — ${f.label}${f.period ? ` (${f.period})` : ''}`),
      `CITATION CATALOG:`,
      ...req.citeCatalog.map((c) => `- [[cite:${c.docId}${c.sectionId ? `#${c.sectionId}` : ''}]] — ${c.title}`),
      `INSTRUCTIONS: ${req.instructions}`,
    ].join('\n');

    try {
      const samples = await Promise.all(
        [0, 1].map(() =>
          this.client.chat({
            messages: [
              { role: 'system', content: DRAFT_SYSTEM_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.4,
            maxTokens: 400,
          }),
        ),
      );
      const texts = samples
        .map((s) => s.content?.trim() ?? '')
        .filter((s) => s.length > 0);
      const firstText = texts[0];
      if (firstText === undefined) return null;
      const secondText = texts[1] ?? firstText;
      return { text: firstText, sampleAgreement: factAgreement(firstText, secondText) };
    } catch {
      return null;
    }
  }
}

function factIdsIn(text: string): Set<string> {
  return new Set([...text.matchAll(/\{\{fact:([^}]+)\}\}/g)].map((m) => (m[1] ?? '').trim()));
}

/** Jaccard overlap of fact ids across two independent samples — a cheap,
 *  observable consistency signal for confidence calibration. */
export function factAgreement(a: string, b: string): number {
  const setA = factIdsIn(a);
  const setB = factIdsIn(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 1 : intersection / union;
}
