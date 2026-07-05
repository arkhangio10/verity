import { describe, expect, it } from 'vitest';
import { FactTable, numberGuard, parseDraft, t } from '@covenant/agent';
import { RATIO_UNIT } from '@covenant/core';

function tableWithFact(id: string): FactTable {
  const facts = new FactTable();
  facts.addDerived({
    id,
    label: 'Net Leverage Ratio',
    value: 3.3775,
    unit: RATIO_UNIT,
    sources: [{ docId: 'filing-2026-Q1', sectionId: 'estado-situacion' }],
  });
  return facts;
}

describe('draft parsing (fact + citation tokens)', () => {
  it('converts tokens into fact and citation spans', () => {
    const facts = tableWithFact('leverage:2026-Q1');
    const parsed = parseDraft(
      'Leverage reached {{fact:leverage:2026-Q1}} at the test date [[cite:credit-agreement-2024#5.1]].',
      facts,
    );
    expect(parsed.unknownFactIds).toEqual([]);
    const kinds = parsed.spans.map((s) => s.kind);
    expect(kinds).toEqual(['text', 'fact', 'text', 'cite', 'text']);
    const citeSpan = parsed.spans.find((s) => s.kind === 'cite');
    expect(citeSpan?.kind === 'cite' && citeSpan.source.sectionId).toBe('5.1');
  });

  it('collects unknown fact ids instead of rendering broken references', () => {
    const facts = tableWithFact('leverage:2026-Q1');
    const parsed = parseDraft('Value {{fact:invented-by-the-model}} looks fine.', facts);
    expect(parsed.unknownFactIds).toEqual(['invented-by-the-model']);
  });
});

describe('number guard: the model narrates, it never supplies numbers', () => {
  it('accepts prose whose only numbers are fact spans and allowed patterns', () => {
    const facts = tableWithFact('leverage:2026-Q1');
    const parsed = parseDraft(
      'In 2026-Q1 leverage reached {{fact:leverage:2026-Q1}} under IFRS 16, per Section 5.1 of the agreement (signed 2024-08-15).',
      facts,
    );
    expect(numberGuard(parsed.spans).ok).toBe(true);
  });

  it('rejects raw numeric values in drafted text', () => {
    const guard = numberGuard([t('Leverage is now 3.38x against a 3.50x cap.')]);
    expect(guard.ok).toBe(false);
    expect(guard.offending.length).toBeGreaterThan(0);
  });

  it('rejects sneaky formats too (percentages, thousands separators)', () => {
    expect(numberGuard([t('headroom of 3.4%')]).ok).toBe(false);
    expect(numberGuard([t('a S/ 45,000 thousand distribution')]).ok).toBe(false);
  });

  it('quarter labels, dates, years and clause references are allowed', () => {
    expect(
      numberGuard([t('Between 2025-Q4 and 2026-Q1 (fiscal 2026, see §5.1 and Cláusula 1.2, NIIF 16).')]).ok,
    ).toBe(true);
  });
});
