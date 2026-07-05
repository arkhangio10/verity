import {
  formatValue,
  PRODUCT_DISCLAIMER,
  RATIO_LABELS,
  RATIO_UNIT,
  STANDARD_DEFINITIONS_DOC_ID,
  type SourceRef,
} from '@covenant/core';
import {
  cite,
  f,
  p,
  strong,
  t,
  type ComposedOutput,
  type OutputSection,
  type ProposalTableRow,
  type Span,
} from '../compose';
import { assessConfidence, minLevel, type ConfidenceAssessment } from '../confidence';
import type { Planner } from '../planner';
import type { PlanStep, RunVerdict } from '../trace';
import { executeTool, type ToolRegistry, type ToolServices } from '../toolkit';
import type { ProposerData } from '../tools/covenantProposer';
import type { StressData } from '../tools/stressTester';
import type { VolatilityData } from '../tools/volatilityAnalyzer';
import type { ModeResult } from './after';
import {
  baseSignals,
  countWord,
  draftOrTemplate,
  emitSection,
  registerBundleFacts,
} from './shared';

function stepById(steps: PlanStep[], id: string): PlanStep {
  const step = steps.find((s) => s.id === id);
  if (!step) throw new Error(`plan step "${id}" missing`);
  return step;
}

/** BEFORE mode: read the historical statements, measure volatility, stress
 *  the ratios and propose a covenant package with justified, cited numbers. */
export async function runBeforeMode(
  services: ToolServices,
  planner: Planner,
  registry: ToolRegistry,
  steps: PlanStep[],
): Promise<ModeResult> {
  const { trace, dataset } = services;

  // ── Step: review data ──────────────────────────────────────────────────
  trace.beginStep(stepById(steps, 'review-data'));
  const bundle = services.resolver.at(services.asOfQuarter);
  registerBundleFacts(services, bundle);
  const latest = services.resolver.quarters().at(-1);
  const hasLeaseFacts =
    latest?.balance.leaseLiabilitiesCurrent !== undefined &&
    latest.balance.leaseLiabilitiesNonCurrent !== undefined;
  if (hasLeaseFacts) {
    services.facts.addValue(latest.balance.leaseLiabilitiesCurrent!, `lease-liab-current:${services.asOfQuarter}`);
    services.facts.addValue(latest.balance.leaseLiabilitiesNonCurrent!, `lease-liab-noncurrent:${services.asOfQuarter}`);
  }
  trace.note(
    `Design engagement for ${dataset.company.name} (${dataset.adapter.countryName}, ${dataset.adapter.accountingStandard}); ${countWord(dataset.quarters.length)} quarters of history available, statements in ${dataset.adapter.currency}.`,
  );
  if (dataset.freshness.stale) {
    trace.decision(
      'Data freshness check failed',
      `Latest filing is ${dataset.freshness.ageDays ?? '?'} days old (policy allows ${dataset.freshness.policyMaxAgeDays}); the proposal will be flagged for refresh before committee.`,
      'warning',
    );
  }
  trace.note(
    'No executed agreement governs yet, so standard definition templates apply — every choice below remains negotiable in documentation.',
  );
  trace.endStep();

  // ── Step: market standards (retrieval) ──────────────────────────────────
  trace.beginStep(stepById(steps, 'market-standards'));
  for (const query of [
    'typical leverage covenant levels and step-downs mid-market term loans',
    'covenant cushion sizing for seasonal EBITDA volatility',
  ]) {
    await executeTool(registry, 'document_retriever', { query, docKind: 'knowledge', k: 3 }, services);
  }
  const llmNote = await planner.note(
    'In one sentence: why should covenant cushions widen when quarterly EBITDA is seasonal or volatile?',
  );
  if (llmNote) trace.note(llmNote, 'llm');
  trace.endStep();

  // ── Step: baseline metrics ──────────────────────────────────────────────
  trace.beginStep(stepById(steps, 'baseline-metrics'));
  await executeTool(registry, 'ratio_calculator', { ratio: 'all' }, services);
  await executeTool(registry, 'ratio_calculator', { ratio: 'leverage', series: true }, services);
  trace.endStep();

  // ── Step: volatility ────────────────────────────────────────────────────
  trace.beginStep(stepById(steps, 'volatility'));
  const volOutcome = await executeTool<VolatilityData>(
    registry,
    'volatility_analyzer',
    { target: 'ebitda' },
    services,
  );
  const cov = volOutcome.data.stats.coefficientOfVariation;
  trace.decision(
    cov > services.policy.proposal.highVolCovCutoff ? 'High EBITDA volatility' : 'Moderate EBITDA volatility',
    `Quarterly coefficient of variation ${formatValue(cov, { kind: 'percent' })} across ${volOutcome.data.stats.n} quarters ${cov > services.policy.proposal.highVolCovCutoff ? 'exceeds' : 'is within'} the policy cutoff of ${formatValue(services.policy.proposal.highVolCovCutoff, { kind: 'percent' })} — ${cov > services.policy.proposal.highVolCovCutoff ? 'the package needs an extra cushion and LTM testing to damp seasonality' : 'standard cushions apply'}.`,
    'info',
  );
  trace.endStep();

  // ── Step: stress ────────────────────────────────────────────────────────
  trace.beginStep(stepById(steps, 'stress'));
  const stressOutcome = await executeTool<StressData>(registry, 'stress_tester', {}, services);
  trace.endStep();

  // ── Step: propose package ───────────────────────────────────────────────
  trace.beginStep(stepById(steps, 'propose-package'));
  const proposal = await executeTool<ProposerData>(registry, 'covenant_proposer', {}, services);
  const pkg = proposal.data.package;
  trace.decision(
    'Covenant package derived',
    `${pkg.covenants.map((c) => `${c.name} ${c.comparator === 'max' ? '≤' : '≥'} ${formatValue(c.threshold, RATIO_UNIT)}`).join('; ')} — thresholds derive from the deterministic policy (worst stressed level + volatility cushion, rounded to market steps).`,
    'info',
  );
  trace.endStep();

  // ── Step: confidence ────────────────────────────────────────────────────
  trace.beginStep(stepById(steps, 'assess-confidence'));
  const base = baseSignals(services, bundle);
  const overallAssessment = assessConfidence({
    ...base,
    definitionSource: 'default_template',
    retrievalCorroborated: null,
  });
  trace.emit({
    type: 'confidence',
    subject: 'Covenant design proposal (overall)',
    level: overallAssessment.level,
    justification: overallAssessment.justification,
  });
  trace.endStep();

  // ── Step: compose term sheet ────────────────────────────────────────────
  trace.beginStep(stepById(steps, 'compose-term-sheet'));
  const sections: OutputSection[] = [];
  const templateRef: SourceRef = {
    docId: STANDARD_DEFINITIONS_DOC_ID,
    docTitle: 'Standard Definition Templates',
  };
  const marketRef: SourceRef | null = dataset.documents.some((d) => d.id === 'market-standards')
    ? { docId: 'market-standards', docTitle: 'Market Standards for Covenant Packages', sectionId: 'conventions' }
    : null;

  // Financial profile
  {
    sections.push(
      emitSection(services, {
        id: 'profile',
        heading: 'Financial profile (LTM)',
        blocks: [
          {
            kind: 'key_values',
            items: [
              { label: 'Covenant EBITDA (LTM)', factId: `ebitda:${services.asOfQuarter}` },
              { label: 'Net Debt', factId: `net-debt:${services.asOfQuarter}` },
              { label: 'Net Leverage', factId: `leverage:${services.asOfQuarter}` },
              { label: 'DSCR', factId: `dscr:${services.asOfQuarter}` },
              { label: 'Current ratio', factId: `current_ratio:${services.asOfQuarter}` },
              { label: 'Distributions (LTM)', factId: `distributions:${services.asOfQuarter}` },
            ],
          },
          p(
            t('Figures follow the standard definition templates '),
            cite(templateRef),
            t(
              ` pending negotiated definitions; lease liabilities under ${dataset.adapter.accountingStandard} are treated as debt in the baseline.`,
            ),
          ),
        ],
        draftedBy: 'template',
      }),
    );
  }

  // Volatility & stress (LLM-draftable intro)
  {
    const worstLeverage = proposal.data.worstStressedByRatio.leverage;
    const stressedLevFactId = `leverage:${services.asOfQuarter}|worst-stress`;
    const fallback = [
      p(
        t('Quarterly Covenant EBITDA varies with a coefficient of variation of '),
        f(proposal.data.ebitdaCovFactId),
        t(
          ' across the historical window — the seasonal swing between strong fourth quarters and soft first quarters is structural, so covenants should test on an LTM basis and carry an explicit volatility cushion ',
        ),
        ...(marketRef ? [cite(marketRef)] : []),
        t('.'),
      ),
      p(
        t('Under the worst downside scenario ('),
        strong(worstLeverage.scenario),
        t('), leverage reaches '),
        f(stressedLevFactId),
        t(' against '),
        f(`leverage:${services.asOfQuarter}`),
        t(' today — the proposed cap must clear that stressed level or a routine downturn forces an immediate waiver.'),
      ),
    ];
    const drafted = await draftOrTemplate(planner, services, {
      sectionId: 'volatility-stress',
      heading: 'Volatility & stress evidence',
      instructions:
        'Explain how EBITDA volatility and the worst stressed leverage level drive cushion sizing for the proposed covenants. Reference the CoV fact and the stressed leverage fact.',
      contextSummary: `CoV ${formatValue(cov, { kind: 'percent' })}; worst stressed leverage scenario: ${worstLeverage.scenario}.`,
      factIds: [proposal.data.ebitdaCovFactId, stressedLevFactId, `leverage:${services.asOfQuarter}`],
      citeRefs: marketRef ? [marketRef] : [],
      fallbackBlocks: fallback,
    });
    const conf =
      drafted.sampleAgreement !== null
        ? assessConfidence({ ...overallAssessment.signals, llmSampleAgreement: drafted.sampleAgreement })
        : overallAssessment;
    sections.push(
      emitSection(services, {
        id: 'volatility-stress',
        heading: 'Volatility & stress evidence',
        blocks: drafted.blocks,
        confidence: conf,
        needsHumanReview: conf.level === 'LOW',
        draftedBy: drafted.draftedBy,
      }),
    );
  }

  // Proposed package table
  {
    const rows: ProposalTableRow[] = pkg.covenants.map((c) => {
      const thresholdFactId = proposal.data.thresholdFactIds[c.id];
      const basisSpans: Span[] = [
        t('Current '),
        f(`${c.ratio}:${services.asOfQuarter}`),
        t('; worst stressed '),
        f(`${c.ratio}:${services.asOfQuarter}|worst-stress`),
        t(` (${proposal.data.worstStressedByRatio[c.ratio].scenario})`),
      ];
      if (c.rationaleTags.includes('volatility_cushion')) {
        basisSpans.push(t('; EBITDA volatility '), f(proposal.data.ebitdaCovFactId), t(' adds a cushion step'));
      }
      if (marketRef) basisSpans.push(t(' '), cite(marketRef));
      return {
        covenantId: c.id,
        label: c.name,
        requirementText: `${c.comparator === 'max' ? '≤' : '≥'} ${formatValue(c.threshold, RATIO_UNIT)} (${c.testBasis === 'point_in_time' ? 'point-in-time' : 'LTM'}, ${c.frequency})`,
        stepDownText:
          c.stepDowns && c.stepDowns.length > 0
            ? c.stepDowns.map((sd) => `${formatValue(sd.threshold, RATIO_UNIT)} from ${sd.fromPeriod}`).join('; ')
            : undefined,
        basisSpans,
        sources: [
          ...(thresholdFactId ? services.facts.require(thresholdFactId).sources : []),
        ],
      };
    });
    sections.push(
      emitSection(services, {
        id: 'package',
        heading: 'Proposed covenant package',
        blocks: [
          { kind: 'proposal_table', rows },
          ...(pkg.notes.length > 0 ? pkg.notes.map((note) => p(t(note))) : []),
        ],
        confidence: overallAssessment,
        needsHumanReview: overallAssessment.level === 'LOW',
        draftedBy: 'template',
      }),
    );
  }

  // Recommended definitions
  {
    sections.push(
      emitSection(services, {
        id: 'definitions',
        heading: 'Recommended definitions',
        blocks: [
          p(
            t('Covenant EBITDA: operating profit plus depreciation and amortization, adding back stock compensation and qualifying one-time items with an LTM cap '),
            cite(templateRef),
            t('. The cap keeps add-backs from silently re-rating earnings.'),
          ),
          hasLeaseFacts
            ? p(
                t(`Total Debt: include lease liabilities under ${dataset.adapter.accountingStandard} — the balance currently carries `),
                f(`lease-liab-current:${services.asOfQuarter}`),
                t(' current and '),
                f(`lease-liab-noncurrent:${services.asOfQuarter}`),
                t(' non-current lease obligations; excluding them would understate leverage materially.'),
              )
            : p(
                t(`Total Debt: include lease liabilities under ${dataset.adapter.accountingStandard} where reported, so leverage reflects the full financing burden.`),
              ),
          p(
            t('Debt Service: cash interest plus scheduled principal including lease principal, so the DSCR reflects the full fixed-charge burden.'),
          ),
        ],
        draftedBy: 'template',
      }),
    );
  }

  // Open items
  {
    const openItems: Span[][] = [
      [t('Confirm the add-back schedule and caps with the borrower’s auditors before documentation.')],
      [t('Validate the floating-rate share of the debt stack to refine the rate-shock sensitivity.')],
      ...(dataset.freshness.stale
        ? [[t('Refresh the financial statements — the current set is stale under the data policy and the proposal must be re-run before committee.')]]
        : []),
    ];
    sections.push(
      emitSection(services, {
        id: 'open-items',
        heading: 'Open items',
        blocks: openItems.map((spans) => p(...spans)),
        draftedBy: 'template',
      }),
    );
  }
  trace.endStep();

  const sectionLevels = sections
    .map((s) => s.confidence?.level)
    .filter((l): l is ConfidenceAssessment['level'] => l !== undefined);
  const overallLevel = sectionLevels.reduce((acc, l) => minLevel(acc, l), overallAssessment.level);
  const overall: ConfidenceAssessment = { ...overallAssessment, level: overallLevel };
  const needsHumanReview = overallLevel === 'LOW' || sections.some((s) => s.needsHumanReview);

  const output: ComposedOutput = {
    kind: 'term_sheet',
    title: `Covenant Design Term Sheet — ${dataset.company.name}`,
    companyName: dataset.company.name,
    asOf: dataset.asOfDate,
    basisNote: `Design basis ${services.asOfQuarter} · LTM testing · ${RATIO_LABELS.leverage} anchor`,
    disclaimer: PRODUCT_DISCLAIMER,
    sections,
  };

  // ── Headline verdict: what package was proposed and why ─────────────────
  const leverageCov = pkg.covenants.find((c) => c.ratio === 'leverage');
  const highVol = cov > services.policy.proposal.highVolCovCutoff;
  const capStr = leverageCov ? `${formatValue(leverageCov.threshold, RATIO_UNIT)} maximum leverage cap` : 'covenant package';
  const verdict: RunVerdict = {
    tone: 'ok',
    headline: `Covenant package proposed — ${countWord(pkg.covenants.length)} covenants`,
    detail: `A ${capStr} sized off the worst stressed level${highVol ? ', plus a volatility cushion for seasonal earnings' : ''} — every threshold derived from the numbers, not guessed.`,
    headlineKey: 'v.proposed.h',
    detailKey: 'v.proposed.d',
    statusKey: 'status.proposed',
    actionKey: 'action.proposed',
    params: {
      count: String(pkg.covenants.length),
      cap: capStr,
      cushion: highVol ? '__CUSHION__' : '',
    },
    metrics: [
      ...(leverageCov
        ? [{ label: 'Leverage cap', labelKey: 'm.leverageCap', value: `≤ ${formatValue(leverageCov.threshold, RATIO_UNIT)}`, tone: 'ok' as const }]
        : []),
      { label: 'EBITDA volatility', labelKey: 'm.ebitdaVol', value: formatValue(cov, { kind: 'percent' }), tone: highVol ? 'warning' as const : 'neutral' as const },
      { label: 'Covenants', labelKey: 'm.covenants', value: String(pkg.covenants.length), tone: 'neutral' as const },
      { label: 'Confidence', labelKey: 'm.confidence', value: overallLevel, tone: 'neutral' as const },
    ],
  };

  return { output, overall, needsHumanReview, verdict };
}
