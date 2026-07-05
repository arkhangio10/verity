import { findSection, type ResolvedBundle, type SourceRef } from '@covenant/core';
import {
  collectSectionFactIds,
  numberGuard,
  parseDraft,
  p,
  t,
  type OutputBlock,
  type OutputSection,
} from '../compose';
import type { Fact } from '../facts';
import type { ConfidenceSignals } from '../confidence';
import type { DraftSectionRequest, Planner } from '../planner';
import type { ToolServices } from '../toolkit';

/** Register the headline bundle metrics as facts so composed prose can
 *  reference them (EBITDA, net debt, cash, etc.). */
export function registerBundleFacts(services: ToolServices, bundle: ResolvedBundle): void {
  services.facts.addComputation(bundle.ebitda);
  services.facts.addComputation(bundle.ebit);
  services.facts.addComputation(bundle.netDebt);
  services.facts.addComputation(bundle.totalDebt);
  services.facts.addComputation(bundle.cashTaxes);
  services.facts.addComputation(bundle.cashInterest);
  services.facts.addComputation(bundle.distributions);
  services.facts.addComputation(bundle.unfinancedCapex);
  services.facts.addValue(bundle.cash, `cash:${bundle.periodLabel}`);
  services.facts.addValue(bundle.currentAssets, `current-assets:${bundle.periodLabel}`);
  services.facts.addValue(bundle.currentLiabilities, `current-liabilities:${bundle.periodLabel}`);
}

export function baseSignals(services: ToolServices, bundle: ResolvedBundle): Omit<ConfidenceSignals, 'definitionSource' | 'retrievalCorroborated'> {
  return {
    mode: services.mode,
    dataFresh: !services.dataset.freshness.stale,
    missingInputs: [],
    derivedFallbacks: bundle.missingOptional,
    crossChecksConsistent: null,
    llmSampleAgreement: null,
  };
}

/** Verify that the agreement's clause quotes actually appear in the document
 *  text (verbatim corroboration → a confidence signal, not an assumption). */
export function verifyAgreementClauses(services: ToolServices): {
  allVerified: boolean;
  results: { subject: string; sectionId: string; verified: boolean }[];
} {
  const agreement = services.dataset.agreement;
  if (!agreement) return { allVerified: false, results: [] };
  const doc = services.dataset.documents.find((d) => d.id === agreement.docId);
  const results = agreement.verbatimChecks.map((check) => {
    const section = doc ? findSection(doc, check.sectionId) : undefined;
    const verified = section !== undefined && normalize(section.text).includes(normalize(check.quote));
    return { subject: check.subject, sectionId: check.sectionId, verified };
  });
  return { allVerified: results.length > 0 && results.every((r) => r.verified), results };
}

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

export interface SectionDraftSpec {
  sectionId: string;
  heading: string;
  instructions: string;
  contextSummary: string;
  factIds: string[];
  citeRefs: SourceRef[];
  fallbackBlocks: OutputBlock[];
}

export interface DraftedBlocks {
  blocks: OutputBlock[];
  draftedBy: 'template' | 'llm';
  sampleAgreement: number | null;
}

/** Try an LLM draft for a section; verify it (known facts only, number guard)
 *  and fall back to the deterministic template if it fails any check. */
export async function draftOrTemplate(
  planner: Planner,
  services: ToolServices,
  spec: SectionDraftSpec,
): Promise<DraftedBlocks> {
  const req: DraftSectionRequest = {
    sectionId: spec.sectionId,
    heading: spec.heading,
    mode: services.mode,
    factCatalog: spec.factIds
      .map((id) => services.facts.get(id))
      .filter((fact) => fact !== undefined)
      .map((fact) => ({ id: fact.id, label: fact.label, period: fact.period })),
    citeCatalog: spec.citeRefs.map((r) => ({
      docId: r.docId,
      sectionId: r.sectionId,
      title: [r.docTitle, r.sectionTitle].filter(Boolean).join(' — ') || r.docId,
    })),
    contextSummary: spec.contextSummary,
    instructions: spec.instructions,
  };
  const draft = await planner.draftSection(req);
  if (!draft) return { blocks: spec.fallbackBlocks, draftedBy: 'template', sampleAgreement: null };

  const parsed = parseDraft(draft.text, services.facts);
  if (parsed.unknownFactIds.length > 0) {
    services.trace.warning(
      `LLM draft for "${spec.heading}" referenced unknown facts (${parsed.unknownFactIds.join(', ')}); using template`,
    );
    return { blocks: spec.fallbackBlocks, draftedBy: 'template', sampleAgreement: draft.sampleAgreement };
  }
  const guard = numberGuard(parsed.spans);
  if (!guard.ok) {
    services.trace.warning(
      `LLM draft for "${spec.heading}" contained raw numbers (${guard.offending.join(', ')}); rejected by number guard, using template`,
    );
    return { blocks: spec.fallbackBlocks, draftedBy: 'template', sampleAgreement: draft.sampleAgreement };
  }
  const paragraphs = splitParagraphs(parsed.spans);
  return { blocks: paragraphs, draftedBy: 'llm', sampleAgreement: draft.sampleAgreement };
}

function splitParagraphs(spans: ReturnType<typeof parseDraft>['spans']): OutputBlock[] {
  const blocks: OutputBlock[] = [];
  let current: typeof spans = [];
  const flush = () => {
    if (current.length > 0) {
      blocks.push(p(...current));
      current = [];
    }
  };
  for (const span of spans) {
    if (span.kind === 'text' && span.text.includes('\n\n')) {
      const parts = span.text.split(/\n{2,}/);
      parts.forEach((part, i) => {
        if (part.trim().length > 0) current.push(t(part));
        if (i < parts.length - 1) flush();
      });
    } else {
      current.push(span);
    }
  }
  flush();
  return blocks.length > 0 ? blocks : [p(...spans)];
}

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
];

/** Small counts are written as words so even template prose stays digit-free
 *  (numbers belong to cited fact spans). */
export function countWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

export function emitSection(services: ToolServices, section: OutputSection): OutputSection {
  const facts: Record<string, Fact> = {};
  for (const id of collectSectionFactIds(section)) {
    const fact = services.facts.get(id);
    if (fact) facts[id] = fact;
  }
  services.trace.emit({ type: 'output_section', section, facts });
  return section;
}
