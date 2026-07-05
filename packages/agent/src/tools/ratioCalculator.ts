import { ALL_RATIO_KEYS, computeRatio, formatValue, RATIO_LABELS, type RatioKey } from '@covenant/core';
import { z } from 'zod';
import type { ToolDef, ToolOutcome, ToolServices } from '../toolkit';

const ratioKeySchema = z.enum(['dscr', 'leverage', 'icr', 'current_ratio', 'fccr']);

const argsSchema = z.object({
  ratio: z.union([ratioKeySchema, z.literal('all')]).default('all'),
  period: z.string().regex(/^\d{4}-Q[1-4]$/).optional(),
  series: z.boolean().default(false),
});

type Args = z.infer<typeof argsSchema>;

export interface RatioCalculatorData {
  basis: 'ltm';
  results: { ratio: RatioKey; period: string; value: number; factId: string }[];
}

/** ratio_calculator(inputs, definition) → verified, cited ratio values.
 *  All math runs in @covenant/core; this tool only orchestrates and registers
 *  the resulting facts. */
export const ratioCalculatorTool: ToolDef<Args, RatioCalculatorData> = {
  name: 'ratio_calculator',
  description:
    'Compute covenant ratios (DSCR, leverage, ICR, current ratio, FCCR) from the normalized financial statements using the governing definitions. Set series=true for the full historical quarterly series; otherwise computes at the given period (default: current test period). Returns verified values with citations — never compute these yourself.',
  paramsJsonSchema: {
    type: 'object',
    properties: {
      ratio: {
        type: 'string',
        enum: [...ALL_RATIO_KEYS, 'all'],
        description: 'Which ratio to compute, or "all".',
      },
      period: { type: 'string', description: 'Quarter label like 2026-Q1. Defaults to the test period.' },
      series: { type: 'boolean', description: 'Compute for every quarter with a full LTM window.' },
    },
  },
  argsSchema,
  async run(args, services: ToolServices): Promise<ToolOutcome<RatioCalculatorData>> {
    const keys: RatioKey[] = args.ratio === 'all' ? ALL_RATIO_KEYS : [args.ratio];
    const results: RatioCalculatorData['results'] = [];

    if (args.series) {
      for (const { label, bundle } of services.resolver.series()) {
        for (const key of keys) {
          const comp = computeRatio(key, bundle, services.defs);
          const fact = services.facts.addComputation(comp);
          results.push({ ratio: key, period: label, value: comp.value, factId: fact.id });
        }
      }
    } else {
      const period = args.period ?? services.asOfQuarter;
      const bundle = services.resolver.at(period);
      for (const key of keys) {
        const comp = computeRatio(key, bundle, services.defs);
        const fact = services.facts.addComputation(comp);
        results.push({ ratio: key, period, value: comp.value, factId: fact.id });
      }
    }

    const latest = results[results.length - 1];
    const summary = args.series
      ? `computed ${keys.map((k) => RATIO_LABELS[k]).join(', ')} across ${new Set(results.map((r) => r.period)).size} quarters (LTM basis)`
      : results
          .map((r) => `${RATIO_LABELS[r.ratio]} = ${formatValue(r.value, { kind: 'ratio' })} (${r.period}, LTM)`)
          .join('; ');
    return {
      summary: summary || (latest ? `computed ${latest.ratio}` : 'no ratios computed'),
      factIds: results.map((r) => r.factId),
      data: { basis: 'ltm', results },
    };
  },
};
