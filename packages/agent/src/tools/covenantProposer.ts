import {
  analyzeSeries,
  collectSources,
  computeAllRatios,
  formatValue,
  proposeCovenantPackage,
  RATIO_UNIT,
  runStress,
  type ProposedPackage,
  type RatioKey,
  type SourceRef,
} from '@covenant/core';
import { z } from 'zod';
import { quarterlyEbitda } from '../metrics';
import type { ToolDef, ToolOutcome, ToolServices } from '../toolkit';

const argsSchema = z.object({});

type Args = z.infer<typeof argsSchema>;

export interface ProposerData {
  package: ProposedPackage;
  thresholdFactIds: Record<string, string>;
  currentFactIds: Record<RatioKey, string>;
  worstStressedByRatio: Record<RatioKey, { value: number; scenario: string }>;
  ebitdaCovFactId: string;
}

const MIN_TYPE: RatioKey[] = ['dscr', 'icr', 'current_ratio', 'fccr'];

/** covenant_proposer() → a complete covenant package (ratios + thresholds +
 *  step-downs) from the deterministic proposal policy. The LLM justifies and
 *  narrates; it never chooses the numbers. */
export const covenantProposerTool: ToolDef<Args, ProposerData> = {
  name: 'covenant_proposer',
  description:
    'Propose a covenant package for this borrower: selects which ratios to covenant and sets each threshold (with step-downs) using the deterministic proposal policy over current levels, historical volatility and stress results. Returns the package with the derivation inputs. Do not invent thresholds yourself — always use this tool.',
  paramsJsonSchema: { type: 'object', properties: {} },
  argsSchema,
  async run(_args, services: ToolServices): Promise<ToolOutcome<ProposerData>> {
    const period = services.asOfQuarter;
    const bundle = services.resolver.at(period);
    const current = computeAllRatios(bundle, services.defs);
    const currentFactIds = {} as Record<RatioKey, string>;
    for (const [key, comp] of Object.entries(current)) {
      currentFactIds[key as RatioKey] = services.facts.addComputation(comp).id;
    }

    // Worst stressed value per ratio across the policy shock set: highest for
    // max-type (leverage), lowest for coverage/liquidity ratios.
    const scenarios = runStress(bundle, services.defs, [], services.policy.shocks);
    const worstStressedByRatio = {} as Record<RatioKey, { value: number; scenario: string }>;
    for (const key of Object.keys(current) as RatioKey[]) {
      let worst = { value: current[key].value, scenario: 'base' };
      for (const scenario of scenarios) {
        const v = scenario.ratios[key].value;
        const isWorse = MIN_TYPE.includes(key) ? v < worst.value : v > worst.value;
        if (isWorse) worst = { value: v, scenario: scenario.label };
      }
      worstStressedByRatio[key] = worst;
      services.facts.addComputation(
        scenarios.find((s) => s.label === worst.scenario)?.ratios[key] ?? current[key],
        `${key}:${period}|worst-stress`,
      );
    }

    const ebitdaSeries = services.resolver.quarters().map((q) => quarterlyEbitda(q, services.defs));
    const ebitdaStats = analyzeSeries(ebitdaSeries.map((c) => c.value));
    const ebitdaSources = dedupe(ebitdaSeries.flatMap((c) => collectSources(c)));
    const ebitdaCovFact = services.facts.addDerived({
      id: 'volatility:ebitda:cov',
      label: 'Quarterly Covenant EBITDA — coefficient of variation',
      value: ebitdaStats.coefficientOfVariation,
      unit: { kind: 'percent' },
      sources: ebitdaSources,
      formula: 'sample stdev ÷ mean over the historical quarters',
    });

    const pkg = proposeCovenantPackage(
      {
        asOfPeriod: period,
        current: mapValues(current, (c) => c.value),
        worstStressed: mapValues(worstStressedByRatio, (w) => w.value),
        ebitdaQuarterlyCov: ebitdaStats.coefficientOfVariation,
        hasScheduledAmortization: bundle.scheduledPrincipalLoans.value > 0,
        distributionsShareOfEbitda:
          bundle.ebitda.value !== 0 ? bundle.distributions.value / bundle.ebitda.value : 0,
      },
      services.policy.proposal,
    );

    const knowledgeRef: SourceRef[] = services.dataset.documents.some((d) => d.id === 'market-standards')
      ? [{ docId: 'market-standards', docTitle: 'Market Standards for Covenant Packages', sectionId: 'conventions' }]
      : [];

    const thresholdFactIds: Record<string, string> = {};
    for (const cov of pkg.covenants) {
      const sources = dedupe([
        ...collectSources(current[cov.ratio]),
        ...knowledgeRef,
        ...ebitdaSources.slice(0, 3),
      ]);
      thresholdFactIds[cov.id] = services.facts.addDerived({
        id: `proposal:${cov.id}:threshold`,
        label: `${cov.name} — proposed threshold`,
        value: cov.threshold,
        unit: RATIO_UNIT,
        sources,
        period,
        formula: 'deterministic proposal policy over current level, worst stressed level and EBITDA volatility',
      }).id;
      for (const sd of cov.stepDowns ?? []) {
        services.facts.addDerived({
          id: `proposal:${cov.id}:stepdown:${sd.fromPeriod}`,
          label: `${cov.name} — step-down from ${sd.fromPeriod}`,
          value: sd.threshold,
          unit: RATIO_UNIT,
          sources,
          period: sd.fromPeriod,
          formula: 'step-down glide path from the proposal policy',
        });
      }
    }

    return {
      summary: `proposed ${pkg.covenants.length} covenants: ${pkg.covenants
        .map((c) => `${c.name} ${c.comparator === 'max' ? '≤' : '≥'} ${formatValue(c.threshold, RATIO_UNIT)}`)
        .join('; ')}`,
      factIds: [...Object.values(thresholdFactIds), ebitdaCovFact.id],
      data: {
        package: pkg,
        thresholdFactIds,
        currentFactIds,
        worstStressedByRatio,
        ebitdaCovFactId: ebitdaCovFact.id,
      },
    };
  },
};

function mapValues<K extends string, V, R>(obj: Record<K, V>, fn: (v: V) => R): Record<K, R> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v as V)])) as Record<K, R>;
}

function dedupe(refs: SourceRef[]): SourceRef[] {
  const seen = new Map<string, SourceRef>();
  for (const r of refs) seen.set(`${r.docId}|${r.sectionId ?? ''}|${r.locator ?? ''}`, r);
  return [...seen.values()];
}
