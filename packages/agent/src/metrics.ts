import {
  EngineError,
  moneyUnit,
  type CitedComputation,
  type CitedNode,
  type MetricDefinitions,
  type QuarterFinancials,
} from '@covenant/core';

/** Per-quarter EBITDA (not LTM) for volatility work. Add-back caps are LTM
 *  concepts, so quarterly points use uncapped add-backs — disclosed in notes. */
export function quarterlyEbitda(
  q: QuarterFinancials,
  defs: MetricDefinitions,
): CitedComputation {
  const op = q.income.operatingProfit;
  const da = q.income.depreciationAmortization;
  if (!op || !da) {
    throw new EngineError(
      `missing operating profit or D&A for ${q.period.label}`,
      'MISSING_INPUT',
      { period: q.period.label },
    );
  }
  const inputs: CitedNode[] = [op, da];
  let value = op.value + da.value;
  const notes = ['quarterly basis: add-back caps apply to LTM tests only'];
  for (const ab of defs.ebitda.addBacks) {
    if (ab.key === 'stockCompensation' && q.income.stockCompensation) {
      value += q.income.stockCompensation.value;
      inputs.push(q.income.stockCompensation);
    }
    if (ab.key === 'oneTimeItems') {
      for (const item of q.income.oneTimeItems ?? []) {
        value += item.value;
        inputs.push(item);
      }
    }
  }
  return {
    kind: 'computation',
    id: `ebitda-quarterly:${q.period.label}`,
    label: 'Covenant EBITDA (quarter)',
    value,
    unit: moneyUnit(q.currency, q.scale),
    period: q.period.label,
    formula: 'Operating profit + D&A + add-backs (single quarter)',
    inputs,
    definitionSource: defs.ebitda.clauseRef,
    notes,
  };
}
