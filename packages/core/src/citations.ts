import type { Unit } from './units';

/** Pointer to a location inside a source document. Every extracted number and
 *  every claim in agent output ultimately resolves to one or more of these. */
export interface SourceRef {
  docId: string;
  docTitle?: string;
  sectionId?: string;
  sectionTitle?: string;
  /** Fine-grained location inside the section: a line-item label, account
   *  code, page/line for PDFs, or transaction id for ledger entries. */
  locator?: string;
  /** Verbatim excerpt supporting the value/claim, used for highlighting. */
  quote?: string;
}

/** A leaf number extracted from a document (by an adapter or a parser). */
export interface CitedValue {
  kind: 'value';
  label: string;
  value: number;
  unit: Unit;
  period?: string;
  source: SourceRef;
  /** Present when the value was not read directly, e.g. currency-converted. */
  derivation?: string;
}

/** A number produced by the deterministic engine. Carries the formula and the
 *  full input tree, so every computed figure is auditable down to document
 *  locations. The LLM never produces one of these. */
export interface CitedComputation {
  kind: 'computation';
  id: string;
  label: string;
  value: number;
  unit: Unit;
  period?: string;
  formula: string;
  inputs: CitedNode[];
  /** Where the governing definition came from (agreement clause or template). */
  definitionSource?: SourceRef;
  notes: string[];
}

export type CitedNode = CitedValue | CitedComputation;

export function citedValue(args: {
  label: string;
  value: number;
  unit: Unit;
  source: SourceRef;
  period?: string;
  derivation?: string;
}): CitedValue {
  return { kind: 'value', ...args };
}

function refKey(r: SourceRef): string {
  return `${r.docId}|${r.sectionId ?? ''}|${r.locator ?? ''}`;
}

/** All distinct document locations supporting a node, definition refs included. */
export function collectSources(node: CitedNode): SourceRef[] {
  const seen = new Map<string, SourceRef>();
  const walk = (n: CitedNode): void => {
    if (n.kind === 'value') {
      seen.set(refKey(n.source), n.source);
      return;
    }
    if (n.definitionSource) seen.set(refKey(n.definitionSource), n.definitionSource);
    for (const input of n.inputs) walk(input);
  };
  walk(node);
  return [...seen.values()];
}

export function flattenLeaves(node: CitedNode): CitedValue[] {
  if (node.kind === 'value') return [node];
  return node.inputs.flatMap(flattenLeaves);
}
