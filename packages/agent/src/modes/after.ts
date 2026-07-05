import {
  analyzeDrift,
  formatValue,
  PRODUCT_DISCLAIMER,
  RATIO_LABELS,
  RATIO_UNIT,
  type CovenantSpec,
  type DriftAnalysis,
  type SourceRef,
} from '@covenant/core';
import {
  callout,
  cite,
  f,
  p,
  strong,
  t,
  type ComposedOutput,
  type CovenantTableRow,
  type OutputSection,
  type Span,
} from '../compose';
import { assessConfidence, minLevel, type ConfidenceAssessment } from '../confidence';
import type { Planner } from '../planner';
import type { PlanStep, RunVerdict } from '../trace';
import { executeTool, type ToolRegistry, type ToolServices } from '../toolkit';
import type { CrossCheckData } from '../tools/transactionCrossChecker';
import type { HeadroomData } from '../tools/headroomCalculator';
import type { RatioCalculatorData } from '../tools/ratioCalculator';
import type { StressData } from '../tools/stressTester';
import {
  baseSignals,
  countWord,
  draftOrTemplate,
  emitSection,
  registerBundleFacts,
  verifyAgreementClauses,
} from './shared';

export interface ModeResult {
  output: ComposedOutput;
  overall: ConfidenceAssessment;
  needsHumanReview: boolean;
  verdict?: RunVerdict;
}

function stepById(steps: PlanStep[], id: string): PlanStep {
  const step = steps.find((s) => s.id === id);
  if (!step) throw new Error(`plan step "${id}" missing`);
  return step;
}

/** AFTER mode: verify every covenant against the executed agreement, detect
 *  drift toward a breach, find the likely cause in the transaction ledger and
 *  produce a cited escalation memo with calibrated confidence. */
export async function runAfterMode(
  services: ToolServices,
  planner: Planner,
  registry: ToolRegistry,
  steps: PlanStep[],
): Promise<ModeResult> {
  const { trace, dataset } = services;
  const agreement = dataset.agreement;
  if (!agreement) {
    throw new Error('AFTER mode requires an executed credit agreement in the dataset');
  }

  // ── Step: review data ──────────────────────────────────────────────────
  trace.beginStep(stepById(steps, 'review-data'));
  const bundle = services.resolver.at(services.asOfQuarter);
  registerBundleFacts(services, bundle);
  trace.note(
    `Loaded ${countWord(dataset.quarters.length)} quarters of normalized statements for ${dataset.company.name} via the ${dataset.adapter.countryName} adapter (${dataset.adapter.sourceSystem}); test period ${services.asOfQuarter}, currency ${dataset.adapter.currency}.`,
  );
  if (dataset.freshness.stale) {
    trace.decision(
      'Data freshness check failed',
      `Latest filing is ${dataset.freshness.ageDays ?? '?'} days old (policy allows ${dataset.freshness.policyMaxAgeDays}); findings will be capped below HIGH confidence.`,
      'warning',
    );
  } else {
    trace.note(
      `Freshness check passed: latest filing (${dataset.freshness.latestFiledAt ?? dataset.freshness.latestPeriodEnd}) is within the ${dataset.freshness.policyMaxAgeDays}-day policy window.`,
    );
  }
  if (bundle.missingOptional.length > 0) {
    trace.note(`Optional inputs defaulted to zero: ${bundle.missingOptional.join(', ')}.`);
  }
  trace.endStep();

  // ── Step: locate covenants & definitions (retrieval happens repeatedly) ──
  trace.beginStep(stepById(steps, 'locate-covenants'));
  for (const cov of agreement.covenants) {
    await executeTool(registry, 'document_retriever', {
      query: `${cov.name} financial covenant threshold`,
      docId: agreement.docId,
      k: 2,
    }, services);
  }
  for (const query of [
    'Covenant EBITDA definition permitted add-backs',
    'Total Debt definition lease liabilities NIIF 16',
    'Debt Service definition scheduled principal payments',
  ]) {
    await executeTool(registry, 'document_retriever', { query, docId: agreement.docId, k: 2 }, services);
  }
  const verification = verifyAgreementClauses(services);
  for (const r of verification.results) {
    trace.decision(
      r.verified ? `Definition verified verbatim: ${r.subject}` : `Definition NOT verbatim-matched: ${r.subject}`,
      r.verified
        ? `The quoted clause text was found character-for-character in ${agreement.docId} §${r.sectionId}; the structured definition is safe to compute with.`
        : `Could not match the quoted clause in §${r.sectionId}; confidence will be capped.`,
      r.verified ? 'info' : 'warning',
    );
  }
  const llmLocateNote = await planner.note(
    `In one sentence: why must covenant math use the credit agreement's own definitions (add-backs, IFRS 16 leases) instead of textbook formulas?`,
  );
  if (llmLocateNote) trace.note(llmLocateNote, 'llm');
  trace.endStep();

  // ── Step: compute ratios ────────────────────────────────────────────────
  trace.beginStep(stepById(steps, 'compute-ratios'));
  await executeTool<RatioCalculatorData>(registry, 'ratio_calculator', { ratio: 'all' }, services);
  trace.endStep();

  // ── Step: assess headroom ───────────────────────────────────────────────
  trace.beginStep(stepById(steps, 'assess-headroom'));
  const headrooms: HeadroomData[] = [];
  for (const cov of agreement.covenants) {
    const outcome = await executeTool<HeadroomData>(
      registry,
      'headroom_calculator',
      { covenantId: cov.id },
      services,
    );
    headrooms.push(outcome.data);
    const h = outcome.data.headroom;
    if (h.status !== 'compliant') {
      trace.decision(
        h.status === 'breach' ? `BREACH: ${cov.name}` : `Thin headroom: ${cov.name}`,
        `${RATIO_LABELS[cov.ratio]} at ${formatValue(h.actual, RATIO_UNIT)} vs ${h.comparator === 'max' ? 'maximum' : 'minimum'} ${formatValue(h.threshold, RATIO_UNIT)} leaves ${formatValue(h.headroomPct, { kind: 'percent' })} headroom.`,
        h.status === 'breach' ? 'critical' : 'warning',
      );
    }
  }
  const worst = [...headrooms].sort((a, b) => a.headroom.headroomPct - b.headroom.headroomPct)[0];
  if (!worst) throw new Error('no covenants tested');
  const worstSpec = agreement.covenants.find((c) => c.id === worst.headroom.covenantId);
  if (!worstSpec) throw new Error('worst covenant spec missing');
  trace.endStep();

  // ── Step: analyze drift ─────────────────────────────────────────────────
  trace.beginStep(stepById(steps, 'analyze-drift'));
  const seriesOutcome = await executeTool<RatioCalculatorData>(
    registry,
    'ratio_calculator',
    { ratio: worstSpec.ratio, series: true },
    services,
  );
  const points = seriesOutcome.data.results
    .filter((r) => r.ratio === worstSpec.ratio)
    .map((r) => ({ period: r.period, value: r.value }));
  let drift: DriftAnalysis | null = null;
  if (points.length >= 2) {
    drift = analyzeDrift(points, worstSpec);
    const seriesSources: SourceRef[] = seriesOutcome.data.results
      .flatMap((r) => services.facts.get(r.factId)?.sources ?? []);
    services.facts.addDerived({
      id: `drift:${worstSpec.id}:slope`,
      label: `${worstSpec.name} — trend per quarter`,
      value: drift.slopePerQuarter,
      unit: RATIO_UNIT,
      sources: seriesSources,
      formula: 'OLS slope over the recent covenant-ratio path',
    });
    for (const proj of drift.projections) {
      services.facts.addDerived({
        id: `drift:${worstSpec.id}:projection:${proj.period}`,
        label: `${worstSpec.name} — projected level (${proj.period})`,
        value: proj.value,
        unit: RATIO_UNIT,
        sources: seriesSources,
        period: proj.period,
        formula: 'linear projection of the recent trend',
      });
    }
    trace.decision(
      drift.direction === 'toward_breach' ? 'Drift toward breach detected' : 'No adverse drift',
      drift.direction === 'toward_breach'
        ? `${RATIO_LABELS[worstSpec.ratio]} is trending ${formatValue(Math.abs(drift.slopePerQuarter), RATIO_UNIT)} per quarter toward the covenant level${drift.projectedBreachPeriod ? `; on the current path the covenant trips in ${drift.projectedBreachPeriod}` : ''}.`
        : 'The recent covenant path is flat or improving.',
      drift.direction === 'toward_breach' ? (drift.quartersToBreach !== null && drift.quartersToBreach <= 2 ? 'critical' : 'warning') : 'info',
    );
  }
  trace.endStep();

  // ── Step: cross-check transactions ──────────────────────────────────────
  trace.beginStep(stepById(steps, 'cross-check-transactions'));
  const prevPoint = points[points.length - 2];
  let crossCheck: CrossCheckData | null = null;
  if (prevPoint) {
    const outcome = await executeTool<CrossCheckData>(
      registry,
      'transaction_cross_checker',
      { ratio: worstSpec.ratio, fromPeriod: prevPoint.period, toPeriod: services.asOfQuarter },
      services,
    );
    crossCheck = outcome.data;
    services.facts.addComputation(services.resolver.at(prevPoint.period).ebitda);
    const topCause = crossCheck.causes[0];
    trace.decision(
      topCause ? 'Likely cause identified' : 'Cause inconclusive',
      topCause
        ? `${topCause.memo} (${topCause.date}) aligns with the movement direction and accounts for ${formatValue(topCause.explainedShare ?? 0, { kind: 'percent' })} of the adverse net-debt pressure.`
        : 'No ledger transaction lines up with the movement; escalate for manual treasury review.',
      topCause ? 'info' : 'warning',
    );
  }
  trace.endStep();

  // ── Step: stress forward ────────────────────────────────────────────────
  trace.beginStep(stepById(steps, 'stress-forward'));
  const stressOutcome = await executeTool<StressData>(registry, 'stress_tester', {}, services);
  const breaching = stressOutcome.data.scenarios.filter((s) => s.breaches.length > 0);
  if (breaching.length > 0) {
    trace.decision(
      'Forward stress shows breach risk',
      `Covenants trip under: ${breaching.map((s) => s.label).join(' | ')}.`,
      'warning',
    );
  }
  trace.endStep();

  // ── Step: calibrate confidence ─────────────────────────────────────────
  trace.beginStep(stepById(steps, 'assess-confidence'));
  const base = baseSignals(services, bundle);
  const covenantConfidence = new Map<string, ConfidenceAssessment>();
  for (const cov of agreement.covenants) {
    const check = verification.results.find((r) => r.subject.toLowerCase().includes(cov.ratio === 'leverage' ? 'debt' : cov.ratio === 'dscr' ? 'debt service' : 'current'))
      ?? verification.results[0];
    const assessment = assessConfidence({
      ...base,
      definitionSource: 'agreement_verbatim',
      retrievalCorroborated: check ? check.verified : verification.allVerified,
      crossChecksConsistent: cov.id === worstSpec.id ? (crossCheck?.consistent ?? null) : null,
    });
    covenantConfidence.set(cov.id, assessment);
    trace.emit({
      type: 'confidence',
      subject: cov.name,
      level: assessment.level,
      justification: assessment.justification,
    });
  }
  const memoConfidence = assessConfidence({
    ...base,
    definitionSource: 'agreement_verbatim',
    retrievalCorroborated: verification.allVerified,
    crossChecksConsistent: crossCheck?.consistent ?? null,
  });
  trace.emit({
    type: 'confidence',
    subject: 'Escalation memo (overall)',
    level: memoConfidence.level,
    justification: memoConfidence.justification,
  });
  trace.endStep();

  // ── Step: compose memo ──────────────────────────────────────────────────
  trace.beginStep(stepById(steps, 'compose-memo'));
  const sections: OutputSection[] = [];
  const clauseRef = (spec: CovenantSpec): SourceRef[] => (spec.clauseRef ? [spec.clauseRef] : []);
  const wh = worst.headroom;
  const worstActualFactId = `${worstSpec.ratio}:${services.asOfQuarter}`;
  const worstThresholdFactId = `covenant:${worstSpec.id}:threshold:${services.asOfQuarter}`;

  // Summary (LLM-draftable, template fallback)
  {
    const fallback = [
      p(
        t('As of the '),
        strong(services.asOfQuarter),
        t(` test period, ${dataset.company.name} is ${headrooms.some((h) => h.headroom.status === 'breach') ? 'in breach of at least one financial covenant' : `compliant with all ${countWord(agreement.covenants.length)} financial covenants`} under the ${agreement.title}. `),
        t(`Headroom on the ${worstSpec.name} has narrowed to `),
        f(worst.headroomPctFactId),
        t(' — '),
        f(worstActualFactId),
        t(` against a ${wh.comparator === 'max' ? 'maximum' : 'minimum'} of `),
        f(worstThresholdFactId),
        t(' '),
        ...clauseRef(worstSpec).map((r) => cite(r)),
        t('.'),
      ),
      ...(drift?.projectedBreachPeriod
        ? [
            callout(
              drift.quartersToBreach !== null && drift.quartersToBreach <= 2 ? 'critical' : 'warning',
              t(`On the recent trend the ${worstSpec.name.toLowerCase()} trips in `),
              strong(drift.projectedBreachPeriod),
              t(' at a projected '),
              f(`drift:${worstSpec.id}:projection:${drift.projectedBreachPeriod}`),
              t(' absent corrective action.'),
            ),
          ]
        : []),
    ];
    const drafted = await draftOrTemplate(planner, services, {
      sectionId: 'summary',
      heading: 'Summary',
      instructions:
        'Summarize the covenant compliance position, the covenant with the thinnest headroom, and the projected trajectory. Reference the actual level, the threshold and the headroom via fact tokens; cite the covenant clause.',
      contextSummary: `Worst covenant: ${worstSpec.name}, status ${wh.status}. Projected breach: ${drift?.projectedBreachPeriod ?? 'none'}.`,
      factIds: [worstActualFactId, worstThresholdFactId, worst.headroomPctFactId],
      citeRefs: clauseRef(worstSpec),
      fallbackBlocks: fallback,
    });
    const conf = drafted.sampleAgreement !== null
      ? assessConfidence({ ...memoConfidence.signals, llmSampleAgreement: drafted.sampleAgreement })
      : memoConfidence;
    sections.push(
      emitSection(services, {
        id: 'summary',
        heading: 'Summary',
        blocks: drafted.blocks,
        confidence: conf,
        needsHumanReview: conf.level === 'LOW',
        draftedBy: drafted.draftedBy,
      }),
    );
  }

  // Compliance table
  {
    const rows: CovenantTableRow[] = headrooms.map((h) => {
      const spec = agreement.covenants.find((c) => c.id === h.headroom.covenantId);
      return {
        covenantId: h.headroom.covenantId,
        label: h.headroom.covenantName,
        requirementText: `${h.headroom.comparator === 'max' ? '≤' : '≥'} ${formatValue(h.headroom.threshold, RATIO_UNIT)} (${spec?.testBasis === 'point_in_time' ? 'point-in-time' : 'LTM'})`,
        actualFactId: `${h.headroom.ratio}:${services.asOfQuarter}`,
        headroomPctFactId: h.headroomPctFactId,
        status: h.headroom.status,
        sources: spec?.clauseRef ? [spec.clauseRef] : [],
      };
    });
    const worstLevel = [...covenantConfidence.values()].reduce(
      (acc, c) => minLevel(acc, c.level),
      'HIGH' as ConfidenceAssessment['level'],
    );
    sections.push(
      emitSection(services, {
        id: 'compliance',
        heading: 'Covenant compliance',
        blocks: [{ kind: 'covenant_table', rows }],
        confidence: { ...memoConfidence, level: worstLevel },
        needsHumanReview: worstLevel === 'LOW',
        draftedBy: 'template',
      }),
    );
  }

  // Drift & projection
  if (drift && points.length >= 2) {
    const chain: Span[] = [];
    points.slice(-4).forEach((pt, i) => {
      if (i > 0) chain.push(t(' → '));
      chain.push(f(`${worstSpec.ratio}:${pt.period}`));
    });
    sections.push(
      emitSection(services, {
        id: 'drift',
        heading: 'Drift analysis',
        blocks: [
          p(
            t(`${RATIO_LABELS[worstSpec.ratio]} over the recent test periods: `),
            ...chain,
            t('. The fitted trend moves '),
            f(`drift:${worstSpec.id}:slope`),
            t(' per quarter toward the covenant level.'),
          ),
          ...(drift.projectedBreachPeriod
            ? [
                p(
                  t('Projecting that trend forward, the covenant level is crossed in '),
                  strong(drift.projectedBreachPeriod),
                  t(' at '),
                  f(`drift:${worstSpec.id}:projection:${drift.projectedBreachPeriod}`),
                  t('. Linear projection is an early-warning heuristic, not a forecast; treasury actions can bend the path.'),
                ),
              ]
            : [p(t('No breach is projected within the horizon on the current trend.'))]),
        ],
        draftedBy: 'template',
      }),
    );
  }

  // Root cause
  if (crossCheck) {
    const intro = p(
      t('Net debt moved by '),
      f(crossCheck.movement.netDebtDeltaFactId),
      t(` between ${crossCheck.fromPeriod} and ${crossCheck.toPeriod}. Ranked against the transaction ledger, the movement is explained by:`),
    );
    const items = crossCheck.causes.slice(0, 3).map((cause) => ({
      rank: cause.rank,
      title: cause.memo,
      spans: [
        t(`${cause.narrative}. This entry accounts for `),
        ...(cause.explainedShareFactId ? [f(cause.explainedShareFactId)] : []),
        t(' of the adverse pressure on net debt in the window '),
        cite(cause.source),
        t('.'),
      ],
      explainedShareFactId: cause.explainedShareFactId,
      evidence: [
        {
          transactionId: cause.transactionId,
          date: cause.date,
          memo: cause.memo,
          amountFactId: cause.amountFactId,
          source: cause.source,
        },
      ],
    }));
    const financingBlocks =
      crossCheck.financing.length > 0
        ? [
            p(
              t('Funding mechanics: the outflows were financed by '),
              f(crossCheck.financing[0]!.amountFactId),
              t(' drawn on the revolving facility '),
              cite(crossCheck.financing[0]!.source),
              t(' — net-debt neutral in isolation, but it confirms how the distribution was funded.'),
            ),
          ]
        : [];
    const ebitdaBlocks =
      crossCheck.movement.ebitdaLtmDelta < 0 && prevPoint
        ? [
            p(
              t('LTM Covenant EBITDA also softened, from '),
              f(`ebitda:${prevPoint.period}`),
              t(' to '),
              f(`ebitda:${services.asOfQuarter}`),
              t(', compounding the leverage pressure.'),
            ),
          ]
        : [];
    const causeConf = assessConfidence({
      ...base,
      definitionSource: 'agreement_verbatim',
      retrievalCorroborated: verification.allVerified,
      crossChecksConsistent: crossCheck.consistent,
    });
    sections.push(
      emitSection(services, {
        id: 'root-cause',
        heading: 'Likely cause',
        blocks: [intro, { kind: 'cause_list', items }, ...financingBlocks, ...ebitdaBlocks],
        confidence: causeConf,
        needsHumanReview: causeConf.level === 'LOW',
        draftedBy: 'template',
      }),
    );
  }

  // Forward stress
  {
    const kv = stressOutcome.data.scenarios.map((s) => ({
      label: `${s.label} — stressed ${RATIO_LABELS[worstSpec.ratio].toLowerCase()}`,
      factId: s.ratios[worstSpec.ratio]?.factId,
      text: s.breaches.length > 0 ? 'covenant trips' : 'compliant',
    }));
    sections.push(
      emitSection(services, {
        id: 'stress-forward',
        heading: 'Forward stress',
        blocks: [
          { kind: 'key_values', items: kv },
          ...(breaching.length > 0
            ? [
                callout(
                  'warning',
                  t('A moderate earnings decline alone is enough to trip the covenant at the next test; the cushion no longer absorbs a normal downside scenario.'),
                ),
              ]
            : []),
        ],
        draftedBy: 'template',
      }),
    );
  }

  // Recommended actions (LLM-draftable)
  {
    const fallback = [
      p(t('Notify the account officer and request a compliance certificate with the borrower’s own covenant computation for the current test period '), ...(agreement.covenants[0]?.clauseRef ? [cite({ docId: agreement.docId, sectionId: 'reporting' })] : []), t('.')),
      p(t('Engage the borrower on distribution policy before the next test date; on the current trajectory further shareholder payments would consume the remaining cushion.')),
      p(t('Prepare the waiver/amendment posture in advance: agree internally on pricing and conditions for a temporary leverage holiday should the projected breach materialize.')),
      p(t('Move the account to monthly monitoring with a rolling covenant projection until headroom is restored.')),
    ];
    const drafted = await draftOrTemplate(planner, services, {
      sectionId: 'recommendations',
      heading: 'Recommended actions',
      instructions:
        'Recommend concrete next steps for the lender given thin covenant headroom, a projected breach and a distribution-driven cause. No numbers.',
      contextSummary: `Worst covenant ${worstSpec.name} status ${wh.status}; projected breach ${drift?.projectedBreachPeriod ?? 'none'}; top cause: ${crossCheck?.causes[0]?.memo ?? 'unknown'}.`,
      factIds: [],
      citeRefs: [{ docId: agreement.docId, sectionId: 'reporting' }],
      fallbackBlocks: fallback,
    });
    sections.push(
      emitSection(services, {
        id: 'recommendations',
        heading: 'Recommended actions',
        blocks: drafted.blocks,
        draftedBy: drafted.draftedBy,
      }),
    );
  }

  // Appendix
  {
    sections.push(
      emitSection(services, {
        id: 'appendix',
        heading: 'Appendix — definitions, data & method',
        blocks: [
          {
            kind: 'key_values',
            items: [
              {
                label: 'Covenant EBITDA',
                text: 'operating profit + D&A + permitted add-backs (stock compensation; qualifying one-time items, capped per LTM period)',
                sources: agreement.definitions.ebitda.clauseRef ? [agreement.definitions.ebitda.clauseRef] : [],
              },
              {
                label: 'Total Debt',
                text: `interest-bearing debt${agreement.definitions.debt.includeLeaseLiabilities ? ' including lease liabilities (NIIF 16)' : ' excluding lease liabilities'}`,
                sources: agreement.definitions.debt.clauseRef ? [agreement.definitions.debt.clauseRef] : [],
              },
              {
                label: 'Debt Service',
                text: `${agreement.definitions.debtService.interestBasis} interest + scheduled principal${agreement.definitions.debtService.includeLeasePrincipal ? ' + lease principal' : ''}`,
                sources: agreement.definitions.debtService.clauseRef ? [agreement.definitions.debtService.clauseRef] : [],
              },
              {
                label: 'Data freshness',
                text: `latest filing ${dataset.freshness.latestFiledAt ?? 'n/a'} for period ending ${dataset.freshness.latestPeriodEnd}${dataset.freshness.stale ? ' — STALE under policy' : ' — within policy'}`,
              },
              {
                label: 'Method',
                text: 'all figures computed deterministically from cited statement lines under the agreement’s definitions; the language model narrates only and is blocked from emitting numbers',
              },
            ],
          },
        ],
        draftedBy: 'template',
      }),
    );
  }
  trace.endStep();

  const sectionLevels = sections
    .map((s) => s.confidence?.level)
    .filter((l): l is ConfidenceAssessment['level'] => l !== undefined);
  const overallLevel = sectionLevels.reduce((acc, l) => minLevel(acc, l), memoConfidence.level);
  const overall: ConfidenceAssessment = { ...memoConfidence, level: overallLevel };
  const needsHumanReview = overallLevel === 'LOW' || sections.some((s) => s.needsHumanReview);

  const output: ComposedOutput = {
    kind: 'escalation_memo',
    title: `Covenant Escalation Memo — ${dataset.company.name}`,
    companyName: dataset.company.name,
    asOf: dataset.asOfDate,
    basisNote: `Test period ${services.asOfQuarter} · LTM basis · ${agreement.title}`,
    disclaimer: PRODUCT_DISCLAIMER,
    sections,
  };

  // ── Headline verdict (the one line a reader sees first) ─────────────────
  const anyBreach = headrooms.some((h) => h.headroom.status === 'breach');
  const topCause = crossCheck?.causes[0];
  const wh2 = worst.headroom;
  const headroomStr = formatValue(wh2.headroomPct, { kind: 'percent' });
  let tone: RunVerdict['tone'];
  let headline: string;
  let detail: string;
  let headlineKey: string;
  let detailKey: string;
  let actionKey: string;
  const params: Record<string, string> = {
    covenant: worstSpec.name,
    company: dataset.company.name,
    period: services.asOfQuarter,
    headroom: headroomStr,
  };
  if (anyBreach) {
    tone = 'critical';
    headlineKey = 'v.breach.h';
    detailKey = 'v.breach.d';
    actionKey = 'action.breach';
    headline = `${worstSpec.name} in breach`;
    detail = `${dataset.company.name} is out of compliance on at least one covenant as of ${services.asOfQuarter}. Immediate lender action required.`;
  } else if (drift?.projectedBreachPeriod) {
    tone = drift.quartersToBreach !== null && drift.quartersToBreach <= 2 ? 'critical' : 'warning';
    headlineKey = 'v.drift.h';
    detailKey = 'v.drift.d';
    actionKey = 'action.drift';
    params.breachPeriod = drift.projectedBreachPeriod;
    // pass only the raw cause memo; the UI wraps it with a localized "driven by".
    params.causeText = topCause ? topCause.memo.toLowerCase() : '';
    params.cause = topCause ? ` — driven by ${topCause.memo.toLowerCase()}` : '';
    headline = `Covenant drifting toward breach`;
    detail = `${worstSpec.name} is compliant today but, on the current trend, is projected to breach in ${drift.projectedBreachPeriod}${params.cause}.`;
  } else if (wh2.status === 'tight') {
    tone = 'warning';
    headlineKey = 'v.tight.h';
    detailKey = 'v.tight.d';
    actionKey = 'action.tight';
    headline = `Thin headroom — watch closely`;
    detail = `${worstSpec.name} is compliant but the cushion is thin (${headroomStr}). A moderate downside could trip it.`;
  } else {
    tone = 'ok';
    headlineKey = 'v.compliant.h';
    detailKey = 'v.compliant.d';
    actionKey = 'action.compliant';
    headline = `All covenants compliant`;
    detail = `Every covenant is within its threshold with adequate headroom as of ${services.asOfQuarter}.`;
  }
  const verdict: RunVerdict = {
    tone,
    headline,
    detail,
    headlineKey,
    detailKey,
    statusKey: `status.${tone}`,
    actionKey,
    params,
    metrics: [
      {
        label: worstSpec.name.replace('Maximum ', '').replace('Minimum ', ''),
        value: `${formatValue(wh2.actual, RATIO_UNIT)} / ${wh2.comparator === 'max' ? '≤' : '≥'} ${formatValue(wh2.threshold, RATIO_UNIT)}`,
        tone: wh2.status === 'breach' ? 'critical' : wh2.status === 'tight' ? 'warning' : 'ok',
      },
      {
        label: 'Headroom',
        labelKey: 'm.headroom',
        value: headroomStr,
        tone: wh2.status === 'breach' ? 'critical' : wh2.status === 'tight' ? 'warning' : 'ok',
      },
      ...(drift?.projectedBreachPeriod
        ? [{ label: 'Projected breach', labelKey: 'm.projectedBreach', value: drift.projectedBreachPeriod, tone: 'warning' as const }]
        : []),
      { label: 'Confidence', labelKey: 'm.confidence', value: overallLevel, tone: 'neutral' as const },
    ],
  };

  return { output, overall, needsHumanReview, verdict };
}
