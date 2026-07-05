import {
  collectSources,
  computeHeadroom,
  computeRatio,
  formatValue,
  PERCENT_UNIT,
  RATIO_UNIT,
  type Headroom,
} from '@covenant/core';
import { z } from 'zod';
import type { ToolDef, ToolOutcome, ToolServices } from '../toolkit';

const argsSchema = z.object({
  covenantId: z.string().min(1),
  period: z.string().regex(/^\d{4}-Q[1-4]$/).optional(),
});

type Args = z.infer<typeof argsSchema>;

export interface HeadroomData {
  headroom: Headroom;
  actualFactId: string;
  cushionFactId: string;
  headroomPctFactId: string;
}

/** headroom_calculator(actual, covenant_level) → absolute cushion + % headroom,
 *  with breach/tight status against the covenant's effective threshold
 *  (step-downs included). */
export const headroomCalculatorTool: ToolDef<Args, HeadroomData> = {
  name: 'headroom_calculator',
  description:
    'Measure covenant headroom: recompute the covenant ratio at the test period, compare against the effective contractual threshold (honoring step-downs), and return absolute cushion, percentage headroom and compliant/tight/breach status.',
  paramsJsonSchema: {
    type: 'object',
    properties: {
      covenantId: { type: 'string', description: 'Id of the covenant from the credit agreement.' },
      period: { type: 'string', description: 'Test period quarter label; defaults to current.' },
    },
    required: ['covenantId'],
  },
  argsSchema,
  async run(args, services: ToolServices): Promise<ToolOutcome<HeadroomData>> {
    const spec = services.covenants.find((c) => c.id === args.covenantId);
    if (!spec) {
      throw new Error(
        `covenant "${args.covenantId}" not found; known: ${services.covenants.map((c) => c.id).join(', ') || '(none)'}`,
      );
    }
    const period = args.period ?? services.asOfQuarter;
    const bundle = services.resolver.at(period);
    const ratioComp = computeRatio(spec.ratio, bundle, services.defs);
    const actualFact = services.facts.addComputation(ratioComp);
    const headroom = computeHeadroom(ratioComp.value, spec, period, services.policy.warnHeadroomPct);

    const sources = [...collectSources(ratioComp), ...(spec.clauseRef ? [spec.clauseRef] : [])];
    const cushionFact = services.facts.addDerived({
      id: `headroom:${spec.id}:cushion:${period}`,
      label: `${spec.name} — absolute cushion`,
      value: headroom.cushion,
      unit: RATIO_UNIT,
      sources,
      period,
      formula:
        spec.comparator === 'max' ? 'threshold − actual' : 'actual − threshold',
    });
    const pctFact = services.facts.addDerived({
      id: `headroom:${spec.id}:pct:${period}`,
      label: `${spec.name} — headroom`,
      value: headroom.headroomPct,
      unit: PERCENT_UNIT,
      sources,
      period,
      formula: 'cushion ÷ covenant level',
    });
    const thresholdFact = services.facts.addDerived({
      id: `covenant:${spec.id}:threshold:${period}`,
      label: `${spec.name} — required level`,
      value: headroom.threshold,
      unit: RATIO_UNIT,
      sources: spec.clauseRef ? [spec.clauseRef] : [],
      period,
      formula: 'contractual threshold effective at the test period',
    });

    return {
      summary: `${spec.name}: actual ${formatValue(headroom.actual, RATIO_UNIT)} vs ${spec.comparator === 'max' ? 'max' : 'min'} ${formatValue(headroom.threshold, RATIO_UNIT)} → headroom ${formatValue(headroom.headroomPct, PERCENT_UNIT)} (${headroom.status})`,
      factIds: [actualFact.id, cushionFact.id, pctFact.id, thresholdFact.id],
      data: {
        headroom,
        actualFactId: actualFact.id,
        cushionFactId: cushionFact.id,
        headroomPctFactId: pctFact.id,
      },
    };
  },
};
