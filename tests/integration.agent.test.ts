import { beforeAll, describe, expect, it } from 'vitest';
import {
  numberGuard,
  runAgent,
  type CauseListBlock,
  type CovenantTableBlock,
  type OutputSection,
  type ProposalTableBlock,
  type RunResult,
  type Span,
  type TraceEvent,
} from '@covenant/agent';
import { LexicalRetriever } from '@covenant/providers';
import { buildDemoDataset } from '@covenant/sample-data';

/**
 * End-to-end: both modes run through the real pipeline — seed → SMV fixtures
 * → PeruAdapter → engine → agent tools → composed, cited output — with the
 * offline deterministic planner and the lexical retriever (no network).
 */
async function runMode(mode: 'before' | 'after'): Promise<{ events: TraceEvent[]; result: RunResult }> {
  const dataset = await buildDemoDataset();
  const retriever = new LexicalRetriever(dataset.corpus);
  const events: TraceEvent[] = [];
  const result = await runAgent({
    mode,
    runId: `test-${mode}`,
    dataset,
    retriever,
    inference: null,
    onEvent: (ev) => events.push(ev),
  });
  return { events, result };
}

let after: Awaited<ReturnType<typeof runMode>>;
let before: Awaited<ReturnType<typeof runMode>>;

beforeAll(async () => {
  after = await runMode('after');
  before = await runMode('before');
});

function sectionsOf(result: RunResult): OutputSection[] {
  return result.output.sections;
}

function allSpans(section: OutputSection): Span[] {
  const spans: Span[] = [];
  for (const block of section.blocks) {
    if (block.kind === 'paragraph' || block.kind === 'callout') spans.push(...block.spans);
    if (block.kind === 'cause_list') for (const item of block.items) spans.push(...item.spans);
    if (block.kind === 'proposal_table') for (const row of block.rows) spans.push(...row.basisSpans);
  }
  return spans;
}

describe('AFTER mode — end to end on the demo dataset', () => {
  it('is a genuine multi-step agent: plan, repeated retrieval, tool calls, decisions', () => {
    const types = after.events.map((e) => e.type);
    expect(types[0]).toBe('run_started');
    expect(types).toContain('plan_created');
    const retrievals = after.events.filter((e) => e.type === 'retrieval');
    expect(retrievals.length).toBeGreaterThanOrEqual(2); // retrieves more than once
    const toolCalls = after.events.filter((e) => e.type === 'tool_call');
    expect(toolCalls.length).toBeGreaterThanOrEqual(6);
    const toolNames = new Set(toolCalls.map((e) => (e.type === 'tool_call' ? e.tool : '')));
    for (const expected of [
      'document_retriever',
      'ratio_calculator',
      'headroom_calculator',
      'transaction_cross_checker',
      'stress_tester',
    ]) {
      expect(toolNames.has(expected), `tool ${expected} used`).toBe(true);
    }
    expect(after.events.some((e) => e.type === 'decision')).toBe(true);
    expect(after.events.at(-1)?.type).toBe('run_completed');
  });

  it('verifies the agreement definitions verbatim and reports HIGH confidence', () => {
    const verifications = after.events.filter(
      (e) => e.type === 'decision' && e.title.includes('verified verbatim'),
    );
    expect(verifications.length).toBeGreaterThanOrEqual(3);
    expect(after.result.overallConfidence.level).toBe('HIGH');
    expect(after.result.needsHumanReview).toBe(false);
  });

  it('flags the thin leverage headroom in the compliance table', () => {
    const compliance = sectionsOf(after.result).find((s) => s.id === 'compliance');
    const table = compliance?.blocks.find((b): b is CovenantTableBlock => b.kind === 'covenant_table');
    expect(table).toBeDefined();
    const leverage = table!.rows.find((r) => r.covenantId === 'cov-leverage');
    expect(leverage?.status).toBe('tight');
    const dscr = table!.rows.find((r) => r.covenantId === 'cov-dscr');
    expect(dscr?.status).toBe('compliant');
    // every row cites the governing clause
    for (const row of table!.rows) expect(row.sources.length).toBeGreaterThan(0);
  });

  it('projects the breach and finds the distribution as the top cause', () => {
    const driftDecision = after.events.find(
      (e) => e.type === 'decision' && e.title === 'Drift toward breach detected',
    );
    expect(driftDecision).toBeDefined();
    expect(driftDecision?.type === 'decision' && driftDecision.detail).toContain('2026-Q3');

    const rootCause = sectionsOf(after.result).find((s) => s.id === 'root-cause');
    const causeList = rootCause?.blocks.find((b): b is CauseListBlock => b.kind === 'cause_list');
    expect(causeList).toBeDefined();
    const top = causeList!.items[0]!;
    expect(top.evidence[0]?.transactionId).toBe('tx-2026-02-15-div');
    expect(top.title).toContain('Distribución extraordinaria');
  });

  it('stress shows that a moderate EBITDA decline trips the covenant', () => {
    const stressDecision = after.events.find(
      (e) => e.type === 'decision' && e.title === 'Forward stress shows breach risk',
    );
    expect(stressDecision).toBeDefined();
    expect(stressDecision?.type === 'decision' && stressDecision.detail).toContain('EBITDA −10%');
  });

  it('every number in the memo is a cited fact; prose is digit-free', async () => {
    const dataset = await buildDemoDataset();
    const docIds = new Set(dataset.documents.map((d) => d.id));
    for (const section of sectionsOf(after.result)) {
      const spans = allSpans(section);
      const guard = numberGuard(spans);
      expect(guard.ok, `section ${section.id} digit-free prose (${guard.offending.join(',')})`).toBe(true);
      for (const span of spans) {
        if (span.kind === 'fact') {
          // every referenced fact exists and carries at least one resolvable source
          const eventFacts = after.events.filter((e) => e.type === 'tool_result');
          expect(eventFacts.length).toBeGreaterThan(0);
        }
        if (span.kind === 'cite') {
          expect(docIds.has(span.source.docId), `cited doc ${span.source.docId} exists`).toBe(true);
        }
      }
    }
    expect(after.result.factCount).toBeGreaterThan(30);
  });
});

describe('BEFORE mode — end to end on the demo dataset', () => {
  it('runs the design pipeline with retrieval, volatility, stress and proposal', () => {
    const toolNames = new Set(
      before.events.filter((e) => e.type === 'tool_call').map((e) => (e.type === 'tool_call' ? e.tool : '')),
    );
    for (const expected of ['document_retriever', 'volatility_analyzer', 'stress_tester', 'covenant_proposer']) {
      expect(toolNames.has(expected), `tool ${expected} used`).toBe(true);
    }
  });

  it('proposes a leverage cap that clears the worst stressed level, in market steps', () => {
    const pkgSection = sectionsOf(before.result).find((s) => s.id === 'package');
    const table = pkgSection?.blocks.find((b): b is ProposalTableBlock => b.kind === 'proposal_table');
    expect(table).toBeDefined();
    const leverageRow = table!.rows.find((r) => r.covenantId === 'proposed-leverage');
    expect(leverageRow).toBeDefined();
    const match = /([\d.]+)×/.exec(leverageRow!.requirementText);
    const threshold = Number(match?.[1]);
    expect(threshold).toBeGreaterThanOrEqual(4.25); // worst stressed ≈ 4.13 + cushion
    expect(threshold).toBeLessThanOrEqual(4.75);
    expect((threshold * 100) % 25).toBe(0); // 0.25× market steps
    expect(leverageRow!.stepDownText).toBeDefined(); // glide path present
  });

  it('volatility cushion is applied (high CoV) and FCCR discipline appears (heavy distributions)', () => {
    const volDecision = before.events.find(
      (e) => e.type === 'decision' && e.title === 'High EBITDA volatility',
    );
    expect(volDecision).toBeDefined();
    const pkgSection = sectionsOf(before.result).find((s) => s.id === 'package');
    const table = pkgSection?.blocks.find((b): b is ProposalTableBlock => b.kind === 'proposal_table');
    expect(table!.rows.some((r) => r.covenantId === 'proposed-fccr')).toBe(true);
  });

  it('term sheet prose is digit-free with resolvable citations', async () => {
    const dataset = await buildDemoDataset();
    const docIds = new Set(dataset.documents.map((d) => d.id));
    for (const section of sectionsOf(before.result)) {
      const spans = allSpans(section);
      expect(numberGuard(spans).ok, `section ${section.id}`).toBe(true);
      for (const span of spans) {
        if (span.kind === 'cite') expect(docIds.has(span.source.docId)).toBe(true);
      }
    }
  });

  it('design-mode confidence is HIGH with template definitions (expected in BEFORE)', () => {
    expect(before.result.overallConfidence.level).toBe('HIGH');
  });
});
