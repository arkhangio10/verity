import {
  analyzeSeries,
  collectSources,
  computeRatio,
  formatValue,
  PERCENT_UNIT,
  type SourceRef,
  type VolatilityStats,
} from '@covenant/core';
import { z } from 'zod';
import { quarterlyEbitda } from '../metrics';
import type { ToolDef, ToolOutcome, ToolServices } from '../toolkit';

const argsSchema = z.object({
  target: z.enum(['ebitda', 'ratio']).default('ebitda'),
  ratio: z.enum(['dscr', 'leverage', 'icr', 'current_ratio', 'fccr']).optional(),
});

type Args = z.infer<typeof argsSchema>;

export interface VolatilityData {
  target: string;
  series: { period: string; value: number; factId?: string }[];
  stats: VolatilityStats;
  covFactId: string;
}

/** volatility_analyzer(historical_series) → variability (coefficient of
 *  variation) of quarterly EBITDA or of a covenant-ratio series. */
export const volatilityAnalyzerTool: ToolDef<Args, VolatilityData> = {
  name: 'volatility_analyzer',
  description:
    'Analyze historical variability. target="ebitda" measures quarterly Covenant-EBITDA volatility (coefficient of variation, trend); target="ratio" with a ratio key analyzes the LTM covenant-ratio series. Use this to size cushions and detect seasonality.',
  paramsJsonSchema: {
    type: 'object',
    properties: {
      target: { type: 'string', enum: ['ebitda', 'ratio'] },
      ratio: { type: 'string', enum: ['dscr', 'leverage', 'icr', 'current_ratio', 'fccr'] },
    },
  },
  argsSchema,
  async run(args, services: ToolServices): Promise<ToolOutcome<VolatilityData>> {
    let series: { period: string; value: number; factId?: string }[];
    let sources: SourceRef[] = [];
    let targetLabel: string;

    if (args.target === 'ratio') {
      const key = args.ratio ?? 'leverage';
      targetLabel = `${key} (LTM series)`;
      series = services.resolver.series().map(({ label, bundle }) => {
        const comp = computeRatio(key, bundle, services.defs);
        const fact = services.facts.addComputation(comp);
        sources = sources.concat(collectSources(comp));
        return { period: label, value: comp.value, factId: fact.id };
      });
    } else {
      targetLabel = 'Covenant EBITDA (quarterly)';
      series = services.resolver.quarters().map((q) => {
        const comp = quarterlyEbitda(q, services.defs);
        const fact = services.facts.addComputation(comp);
        sources = sources.concat(collectSources(comp));
        return { period: q.period.label, value: comp.value, factId: fact.id };
      });
    }

    const stats = analyzeSeries(series.map((s) => s.value));
    const dedupedSources = dedupe(sources);
    const covFact = services.facts.addDerived({
      id: `volatility:${args.target}${args.ratio ? `:${args.ratio}` : ''}:cov`,
      label: `${targetLabel} — coefficient of variation`,
      value: stats.coefficientOfVariation,
      unit: PERCENT_UNIT,
      sources: dedupedSources,
      formula: 'sample stdev ÷ mean over the historical series',
    });

    return {
      summary: `${targetLabel}: CoV ${formatValue(stats.coefficientOfVariation, PERCENT_UNIT)} over ${stats.n} quarters, trend ${stats.trendSlopePerPeriod >= 0 ? 'rising' : 'falling'}`,
      factIds: [covFact.id, ...series.flatMap((s) => (s.factId ? [s.factId] : []))],
      data: { target: targetLabel, series, stats, covFactId: covFact.id },
    };
  },
};

function dedupe(refs: SourceRef[]): SourceRef[] {
  const seen = new Map<string, SourceRef>();
  for (const r of refs) seen.set(`${r.docId}|${r.sectionId ?? ''}|${r.locator ?? ''}`, r);
  return [...seen.values()];
}
