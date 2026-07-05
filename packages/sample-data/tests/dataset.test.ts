import { describe, expect, it } from 'vitest';
import {
  analyzeDrift,
  analyzeSeries,
  computeHeadroom,
  computeRatio,
  findSection,
  resolveBundle,
  resolveBundleSeries,
} from '@covenant/core';
import {
  buildAgreementInfo,
  buildDemoDataset,
  buildQuarters,
  renderAgreementDocument,
  SEED_QUARTERS,
} from '@covenant/sample-data';

describe('seed internal consistency', () => {
  const built = buildQuarters();

  it('balance sheet ties every quarter (assets = liabilities + equity)', () => {
    for (const q of built) {
      expect(
        Math.abs(q.totalAssets - (q.totalLiabilities + q.equity)),
        `${q.label} should tie`,
      ).toBeLessThan(1.5);
    }
  });

  it('cash stays positive across all twelve quarters', () => {
    for (const q of built) {
      expect(q.cash, `${q.label} cash`).toBeGreaterThan(5_000);
    }
  });

  it('cash flow statement explains the cash roll', () => {
    let prev = built[0]!;
    for (const q of built.slice(1)) {
      const delta = q.cfo + q.cfi + q.cff;
      expect(Math.abs(q.cash - (prev.cash + delta)), `${q.label} cash roll`).toBeLessThan(1.5);
      prev = q;
    }
  });

  it('covers twelve consecutive quarters', () => {
    expect(SEED_QUARTERS.length).toBe(12);
    expect(built[0]!.label).toBe('2023-Q2');
    expect(built[built.length - 1]!.label).toBe('2026-Q1');
  });
});

describe('demo dataset through the Peru adapter', () => {
  it('maps with zero warnings and full citations', async () => {
    const dataset = await buildDemoDataset();
    expect(dataset.quarters.length).toBe(12);
    const latest = dataset.quarters[dataset.quarters.length - 1]!;
    expect(latest.period.label).toBe('2026-Q1');
    expect(latest.balance.cashAndEquivalents?.source.docId).toBe('filing-2026-Q1');
    expect(latest.extras?.floatingRateDebtShare?.value).toBeCloseTo(0.55, 10);
    // every filing document referenced by a citation exists in the corpus
    const docIds = new Set(dataset.documents.map((d) => d.id));
    expect(docIds.has('filing-2026-Q1')).toBe(true);
    expect(docIds.has('credit-agreement-2024')).toBe(true);
    expect(dataset.freshness.stale).toBe(false);
  });

  it('agreement verbatim quotes really appear in the rendered document', () => {
    const agreement = buildAgreementInfo();
    const doc = renderAgreementDocument();
    for (const check of agreement.verbatimChecks) {
      const section = findSection(doc, check.sectionId);
      expect(section, `section ${check.sectionId}`).toBeDefined();
      const normalize = (s: string) => s.replace(/\s+/g, ' ').toLowerCase();
      expect(
        normalize(section!.text).includes(normalize(check.quote)),
        `quote for ${check.subject}`,
      ).toBe(true);
    }
  });
});

describe('seeded scenario: the demo tells the intended story', () => {
  it('AFTER: leverage headroom is thin at 2026-Q1 and drifts toward a 2026-Q3 breach', async () => {
    const dataset = await buildDemoDataset();
    const agreement = dataset.agreement!;
    const bundle = resolveBundle(dataset.quarters, '2026-Q1', agreement.definitions);
    const leverage = computeRatio('leverage', bundle, agreement.definitions);
    expect(leverage.value).toBeGreaterThan(3.2);
    expect(leverage.value).toBeLessThan(3.42);

    const spec = agreement.covenants.find((c) => c.id === 'cov-leverage')!;
    const headroom = computeHeadroom(leverage.value, spec, '2026-Q1');
    expect(headroom.status).toBe('tight');
    expect(headroom.headroomPct).toBeLessThan(0.08);

    const series = resolveBundleSeries(dataset.quarters, agreement.definitions);
    const points = series.bundles.map(({ label, bundle: b }) => ({
      period: label,
      value: computeRatio('leverage', b, agreement.definitions).value,
    }));
    const drift = analyzeDrift(points, spec);
    expect(drift.direction).toBe('toward_breach');
    expect(drift.projectedBreachPeriod).toBe('2026-Q3');
  });

  it('AFTER: DSCR and current ratio remain comfortably compliant', async () => {
    const dataset = await buildDemoDataset();
    const agreement = dataset.agreement!;
    const bundle = resolveBundle(dataset.quarters, '2026-Q1', agreement.definitions);
    const dscr = computeRatio('dscr', bundle, agreement.definitions);
    expect(dscr.value).toBeGreaterThan(1.45);
    const current = computeRatio('current_ratio', bundle, agreement.definitions);
    expect(current.value).toBeGreaterThan(1.2);
  });

  it('AFTER: the big distribution exists in the ledger inside the drift window', async () => {
    const dataset = await buildDemoDataset();
    const dividend = dataset.transactions.find((t) => t.id === 'tx-2026-02-15-div');
    expect(dividend).toBeDefined();
    expect(dividend!.category).toBe('distribution');
    expect(dividend!.amount).toBe(45_000);
  });

  it('BEFORE: quarterly EBITDA volatility clearly exceeds the cushion cutoff', async () => {
    const built = buildQuarters();
    const quarterlyEbitda = built.map(
      (q) => q.operatingProfit + q.da + q.stockComp + (q.seed.oneTime?.amount ?? 0),
    );
    const stats = analyzeSeries(quarterlyEbitda);
    expect(stats.coefficientOfVariation).toBeGreaterThan(0.13);
    expect(stats.coefficientOfVariation).toBeLessThan(0.2);
  });
});
