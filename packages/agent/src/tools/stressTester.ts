import {
  formatValue,
  RATIO_UNIT,
  runStress,
  type RatioKey,
  type Shock,
  type StressScenario,
} from '@covenant/core';
import { z } from 'zod';
import type { ToolDef, ToolOutcome, ToolServices } from '../toolkit';

const atomicShockSchema = z.union([
  z.object({ kind: z.literal('ebitda_pct'), pct: z.number().min(-0.9).max(0.9) }),
  z.object({ kind: z.literal('rates_bps'), bps: z.number().min(-1000).max(1000) }),
]);

const shockSchema = z.union([
  atomicShockSchema,
  z.object({ kind: z.literal('combined'), shocks: z.array(atomicShockSchema).min(1).max(4) }),
]);

const argsSchema = z.object({
  shocks: z.array(shockSchema).min(1).max(8).optional(),
  period: z.string().regex(/^\d{4}-Q[1-4]$/).optional(),
});

type Args = z.infer<typeof argsSchema>;

export interface StressScenarioSummary {
  label: string;
  ratios: Record<RatioKey, { value: number; factId: string }>;
  breaches: string[];
  headrooms: { covenantId: string; status: string; headroomPct: number }[];
}

export interface StressData {
  period: string;
  scenarios: StressScenarioSummary[];
}

/** stress_tester(financials, shock) → recomputed ratios + headroom under
 *  EBITDA and interest-rate shocks. */
export const stressTesterTool: ToolDef<Args, StressData> = {
  name: 'stress_tester',
  description:
    'Recompute all covenant ratios under downside shocks (EBITDA −10%/−20%, rates +200 bps, combinations) and report the resulting headroom and any covenant trips. Defaults to the standard shock set at the current test period.',
  paramsJsonSchema: {
    type: 'object',
    properties: {
      shocks: {
        type: 'array',
        description: 'Shock list; each is {kind:"ebitda_pct",pct} or {kind:"rates_bps",bps} or a combined set.',
        items: { type: 'object' },
      },
      period: { type: 'string', description: 'Quarter label; defaults to the test period.' },
    },
  },
  argsSchema,
  async run(args, services: ToolServices): Promise<ToolOutcome<StressData>> {
    const period = args.period ?? services.asOfQuarter;
    const bundle = services.resolver.at(period);
    const shocks = (args.shocks as Shock[] | undefined) ?? services.policy.shocks;
    const scenarios = runStress(
      bundle,
      services.defs,
      services.covenants,
      shocks,
      services.policy.warnHeadroomPct,
    );

    const factIds: string[] = [];
    const summaries: StressScenarioSummary[] = scenarios.map((scenario: StressScenario) => {
      const ratios = {} as StressScenarioSummary['ratios'];
      for (const [key, comp] of Object.entries(scenario.ratios)) {
        const fact = services.facts.addComputation(comp, `${key}:${period}|${scenario.label}`);
        factIds.push(fact.id);
        ratios[key as RatioKey] = { value: comp.value, factId: fact.id };
      }
      return {
        label: scenario.label,
        ratios,
        breaches: scenario.breaches,
        headrooms: scenario.headrooms.map((h) => ({
          covenantId: h.covenantId,
          status: h.status,
          headroomPct: h.headroomPct,
        })),
      };
    });

    const breachingScenarios = summaries.filter((s) => s.breaches.length > 0);
    const worstLeverage = Math.max(...summaries.map((s) => s.ratios.leverage?.value ?? Number.NEGATIVE_INFINITY));
    const summary =
      `ran ${summaries.length} scenario(s) at ${period}; worst stressed leverage ${formatValue(worstLeverage, RATIO_UNIT)}` +
      (breachingScenarios.length > 0
        ? `; covenant trip under: ${breachingScenarios.map((s) => s.label).join(' | ')}`
        : services.covenants.length > 0
          ? '; no covenant trips'
          : '');

    return { summary, factIds, data: { period, scenarios: summaries } };
  },
};
