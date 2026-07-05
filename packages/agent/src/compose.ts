import type { SourceRef } from '@covenant/core';
import type { ConfidenceAssessment } from './confidence';
import type { FactTable } from './facts';

/**
 * Structured, citable output. The right-hand panel renders these blocks; every
 * number is a fact span resolved from the FactTable (with its citations), and
 * every claim can carry inline citation spans. Prose may be drafted by the
 * LLM using {{fact:id}} / [[cite:docId#sectionId]] tokens, but numbers only
 * ever enter through fact ids — enforced by the number guard below.
 */
export type Span =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'fact'; factId: string }
  | { kind: 'cite'; source: SourceRef };

export interface ParagraphBlock {
  kind: 'paragraph';
  spans: Span[];
}

export interface CalloutBlock {
  kind: 'callout';
  tone: 'info' | 'warning' | 'critical';
  spans: Span[];
}

export interface CovenantTableRow {
  covenantId: string;
  label: string;
  /** Requirement rendered by code from the covenant spec (e.g. "≤ 3.50× (LTM)"). */
  requirementText: string;
  actualFactId: string;
  headroomPctFactId: string;
  status: 'compliant' | 'tight' | 'breach';
  sources: SourceRef[];
}

export interface CovenantTableBlock {
  kind: 'covenant_table';
  rows: CovenantTableRow[];
}

export interface CauseEvidence {
  transactionId: string;
  date: string;
  memo: string;
  amountFactId: string;
  source: SourceRef;
}

export interface CauseItem {
  rank: number;
  title: string;
  spans: Span[];
  explainedShareFactId?: string;
  evidence: CauseEvidence[];
}

export interface CauseListBlock {
  kind: 'cause_list';
  items: CauseItem[];
}

export interface KeyValueItem {
  label: string;
  factId?: string;
  text?: string;
  sources?: SourceRef[];
}

export interface KeyValueBlock {
  kind: 'key_values';
  items: KeyValueItem[];
}

export interface ProposalTableRow {
  covenantId: string;
  label: string;
  requirementText: string;
  stepDownText?: string;
  basisSpans: Span[];
  sources: SourceRef[];
}

export interface ProposalTableBlock {
  kind: 'proposal_table';
  rows: ProposalTableRow[];
}

export type OutputBlock =
  | ParagraphBlock
  | CalloutBlock
  | CovenantTableBlock
  | CauseListBlock
  | KeyValueBlock
  | ProposalTableBlock;

export interface OutputSection {
  id: string;
  heading: string;
  blocks: OutputBlock[];
  confidence?: ConfidenceAssessment;
  needsHumanReview?: boolean;
  draftedBy: 'template' | 'llm';
}

export interface ComposedOutput {
  kind: 'term_sheet' | 'escalation_memo';
  title: string;
  companyName: string;
  asOf: string;
  basisNote: string;
  disclaimer: string;
  sections: OutputSection[];
}

// ── Span helpers ─────────────────────────────────────────────────────────────

export const t = (text: string): Span => ({ kind: 'text', text });
export const strong = (text: string): Span => ({ kind: 'strong', text });
export const f = (factId: string): Span => ({ kind: 'fact', factId });
export const cite = (source: SourceRef): Span => ({ kind: 'cite', source });

export function p(...spans: Span[]): ParagraphBlock {
  return { kind: 'paragraph', spans };
}

export function callout(tone: CalloutBlock['tone'], ...spans: Span[]): CalloutBlock {
  return { kind: 'callout', tone, spans };
}

// ── LLM draft parsing + number guard ────────────────────────────────────────

const TOKEN_RE = /\{\{fact:([a-zA-Z0-9_.:|\- ]+)\}\}|\[\[cite:([^\]#]+)(?:#([^\]]+))?\]\]/g;

export interface ParsedDraft {
  spans: Span[];
  unknownFactIds: string[];
}

/** Parse model-drafted prose into spans. Unknown fact ids are collected so the
 *  caller can reject the draft instead of rendering a broken reference. */
export function parseDraft(text: string, facts: FactTable): ParsedDraft {
  const spans: Span[] = [];
  const unknownFactIds: string[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(TOKEN_RE)) {
    const idx = match.index ?? 0;
    if (idx > lastIndex) spans.push(t(text.slice(lastIndex, idx)));
    const [, factId, citeDoc, citeSection] = match;
    if (factId !== undefined) {
      if (facts.has(factId)) spans.push(f(factId));
      else unknownFactIds.push(factId);
    } else if (citeDoc !== undefined) {
      spans.push(cite({ docId: citeDoc.trim(), sectionId: citeSection?.trim() }));
    }
    lastIndex = idx + match[0].length;
  }
  if (lastIndex < text.length) spans.push(t(text.slice(lastIndex)));
  return { spans, unknownFactIds };
}

/** Patterns that may legitimately contain digits in prose. Everything else
 *  numeric must arrive as a fact span. */
const ALLOWED_NUMERIC_PATTERNS: RegExp[] = [
  /\b\d{4}-Q[1-4]\b/g, // quarter labels
  /\b\d{4}-\d{2}-\d{2}\b/g, // ISO dates
  /\b(?:19|20)\d{2}\b/g, // bare years
  /\b(?:IFRS|NIIF)\s*\d+\b/gi, // accounting standards
  /(?:§|\b(?:Section|Sección|Cláusula|Clause)\s*)\d+(?:\.\d+)*\b/gi, // clause refs
  /\bQ[1-4]\b/g, // bare quarter names
  // signed shock-scenario labels ("EBITDA −20%", "Rates +200 bps") — these are
  // code-generated stress labels, not values; the sign prefix is mandatory.
  /[−+-]\s?\d+(?:\.\d+)?\s*(?:%|bps\b)/g,
];

export interface NumberGuardResult {
  ok: boolean;
  offending: string[];
}

/** Reject drafted text spans that contain digits outside the allowed patterns.
 *  This is the hard rule that the model narrates but never supplies numbers. */
export function numberGuard(spans: Span[]): NumberGuardResult {
  const offending: string[] = [];
  for (const span of spans) {
    if (span.kind !== 'text' && span.kind !== 'strong') continue;
    let residue = span.text;
    for (const pattern of ALLOWED_NUMERIC_PATTERNS) {
      residue = residue.replace(pattern, ' ');
    }
    const matches = residue.match(/\d[\d,.%×x]*/g);
    if (matches) offending.push(...matches.map((m) => m.trim()));
  }
  return { ok: offending.length === 0, offending };
}

/** All fact ids a section references (spans, table cells, evidence rows) —
 *  used to ship the referenced facts alongside the streamed section event. */
export function collectSectionFactIds(section: OutputSection): string[] {
  const ids = new Set<string>();
  const fromSpans = (spans: Span[]) => {
    for (const s of spans) if (s.kind === 'fact') ids.add(s.factId);
  };
  for (const block of section.blocks) {
    switch (block.kind) {
      case 'paragraph':
      case 'callout':
        fromSpans(block.spans);
        break;
      case 'covenant_table':
        for (const row of block.rows) {
          ids.add(row.actualFactId);
          ids.add(row.headroomPctFactId);
        }
        break;
      case 'cause_list':
        for (const item of block.items) {
          fromSpans(item.spans);
          if (item.explainedShareFactId) ids.add(item.explainedShareFactId);
          for (const ev of item.evidence) ids.add(ev.amountFactId);
        }
        break;
      case 'key_values':
        for (const item of block.items) if (item.factId) ids.add(item.factId);
        break;
      case 'proposal_table':
        for (const row of block.rows) fromSpans(row.basisSpans);
        break;
    }
  }
  return [...ids];
}

/** Plain-text projection of a section (used for logs/tests, never the UI). */
export function sectionToPlainText(section: OutputSection, facts: FactTable): string {
  const spanText = (spans: Span[]): string =>
    spans
      .map((s) => {
        switch (s.kind) {
          case 'text':
          case 'strong':
            return s.text;
          case 'fact':
            return facts.get(s.factId)?.formatted ?? `⟨missing fact ${s.factId}⟩`;
          case 'cite':
            return '';
        }
      })
      .join('');
  const lines: string[] = [`## ${section.heading}`];
  for (const block of section.blocks) {
    switch (block.kind) {
      case 'paragraph':
      case 'callout':
        lines.push(spanText(block.spans));
        break;
      case 'covenant_table':
        for (const row of block.rows) {
          lines.push(
            `${row.label}: required ${row.requirementText}, actual ${facts.get(row.actualFactId)?.formatted ?? '?'} (${row.status})`,
          );
        }
        break;
      case 'cause_list':
        for (const item of block.items) lines.push(`${item.rank}. ${item.title} ${spanText(item.spans)}`);
        break;
      case 'key_values':
        for (const item of block.items) {
          lines.push(`${item.label}: ${item.factId ? facts.get(item.factId)?.formatted ?? '?' : item.text ?? ''}`);
        }
        break;
      case 'proposal_table':
        for (const row of block.rows) {
          lines.push(`${row.label}: ${row.requirementText}${row.stepDownText ? ` (${row.stepDownText})` : ''}`);
        }
        break;
    }
  }
  return lines.join('\n');
}
