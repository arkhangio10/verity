import {
  collectSources,
  formatValue,
  type CitedComputation,
  type CitedValue,
  type SourceRef,
  type Unit,
} from '@covenant/core';

/**
 * The fact table is the anti-hallucination boundary. Every number that can
 * appear in agent output is registered here first — always produced by the
 * deterministic engine or by adapter extraction, never by the model. Drafted
 * prose refers to facts by id ({{fact:...}}), and the renderer substitutes
 * the registered value, so the model physically cannot invent a number.
 */
export interface Fact {
  id: string;
  label: string;
  value: number;
  unit: Unit;
  formatted: string;
  period?: string;
  sources: SourceRef[];
  origin: 'computation' | 'value' | 'derived';
  formula?: string;
  notes?: string[];
}

export class FactTable {
  private readonly facts = new Map<string, Fact>();

  addComputation(c: CitedComputation, idOverride?: string): Fact {
    const id = idOverride ?? c.id;
    const existing = this.facts.get(id);
    if (existing) return existing;
    const fact: Fact = {
      id,
      label: c.label,
      value: c.value,
      unit: c.unit,
      formatted: formatValue(c.value, c.unit),
      period: c.period,
      sources: collectSources(c),
      origin: 'computation',
      formula: c.formula,
      notes: c.notes.length > 0 ? c.notes : undefined,
    };
    this.facts.set(id, fact);
    return fact;
  }

  addValue(v: CitedValue, id: string): Fact {
    const existing = this.facts.get(id);
    if (existing) return existing;
    const fact: Fact = {
      id,
      label: v.label,
      value: v.value,
      unit: v.unit,
      formatted: formatValue(v.value, v.unit),
      period: v.period,
      sources: [v.source],
      origin: 'value',
      notes: v.derivation ? [v.derivation] : undefined,
    };
    this.facts.set(id, fact);
    return fact;
  }

  /** For quantities computed by deterministic agent-side code (headroom %,
   *  explained shares, slopes) — sources must be passed explicitly. */
  addDerived(args: {
    id: string;
    label: string;
    value: number;
    unit: Unit;
    sources: SourceRef[];
    period?: string;
    formula?: string;
    notes?: string[];
  }): Fact {
    const existing = this.facts.get(args.id);
    if (existing) return existing;
    const fact: Fact = {
      ...args,
      formatted: formatValue(args.value, args.unit),
      origin: 'derived',
    };
    this.facts.set(args.id, fact);
    return fact;
  }

  get(id: string): Fact | undefined {
    return this.facts.get(id);
  }

  require(id: string): Fact {
    const fact = this.facts.get(id);
    if (!fact) throw new Error(`fact "${id}" not registered`);
    return fact;
  }

  has(id: string): boolean {
    return this.facts.has(id);
  }

  list(): Fact[] {
    return [...this.facts.values()];
  }

  size(): number {
    return this.facts.size;
  }
}
