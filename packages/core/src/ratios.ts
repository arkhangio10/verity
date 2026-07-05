import type { CitedComputation, CitedNode } from './citations';
import type { MetricDefinitions, RatioKey } from './definitions';
import { RATIO_LABELS } from './definitions';
import { EngineError } from './errors';
import type { ResolvedBundle } from './resolve';
import { RATIO_UNIT } from './units';

/**
 * The five covenant ratios. Pure functions over a ResolvedBundle: given the
 * same statements and the same definitions they always return the same
 * numbers, with the complete cited input tree attached. Values are kept
 * exact; rounding is a display concern.
 */

function safeDiv(numerator: number, denominator: number, context: string): number {
  if (Math.abs(denominator) < 1e-9) {
    throw new EngineError(`division by zero computing ${context}`, 'DIV_BY_ZERO', {
      numerator,
      denominator,
    });
  }
  return numerator / denominator;
}

function ratioComp(
  key: RatioKey,
  b: ResolvedBundle,
  value: number,
  formula: string,
  inputs: CitedNode[],
  definitionSource?: CitedComputation['definitionSource'],
  notes: string[] = [],
): CitedComputation {
  return {
    kind: 'computation',
    id: `${key}:${b.periodLabel}`,
    label: RATIO_LABELS[key],
    value,
    unit: RATIO_UNIT,
    period: b.periodLabel,
    formula,
    inputs,
    definitionSource,
    notes,
  };
}

/** DSCR = (EBITDA − cash taxes) ÷ (interest + scheduled principal[, + lease principal]). */
export function computeDscr(b: ResolvedBundle, defs: MetricDefinitions): CitedComputation {
  const includeLease = defs.debtService.includeLeasePrincipal;
  const numerator = b.ebitda.value - b.cashTaxes.value;
  const denomInputs = includeLease
    ? [b.cashInterest, b.scheduledPrincipalLoans, b.leasePrincipal]
    : [b.cashInterest, b.scheduledPrincipalLoans];
  const denominator = denomInputs.reduce((acc, c) => acc + c.value, 0);
  return ratioComp(
    'dscr',
    b,
    safeDiv(numerator, denominator, 'DSCR'),
    `(Covenant EBITDA − cash taxes) ÷ (interest + scheduled principal${includeLease ? ' + lease principal' : ''})`,
    [b.ebitda, b.cashTaxes, ...denomInputs],
    defs.debtService.clauseRef,
    [includeLease ? 'lease principal included in debt service per definition' : 'lease principal excluded from debt service per definition'],
  );
}

/** Leverage = Net Debt ÷ Covenant EBITDA. */
export function computeLeverage(b: ResolvedBundle, defs: MetricDefinitions): CitedComputation {
  return ratioComp(
    'leverage',
    b,
    safeDiv(b.netDebt.value, b.ebitda.value, 'leverage'),
    'Net Debt ÷ Covenant EBITDA (LTM)',
    [b.netDebt, b.ebitda],
    defs.debt.clauseRef,
  );
}

/** ICR = EBIT ÷ interest expense (accrual). */
export function computeIcr(b: ResolvedBundle, _defs: MetricDefinitions): CitedComputation {
  return ratioComp(
    'icr',
    b,
    safeDiv(b.ebit.value, b.interestExpense.value, 'ICR'),
    'EBIT ÷ interest expense (LTM)',
    [b.ebit, b.interestExpense],
  );
}

/** Current ratio = current assets ÷ current liabilities (point in time). */
export function computeCurrentRatio(b: ResolvedBundle, _defs: MetricDefinitions): CitedComputation {
  return ratioComp(
    'current_ratio',
    b,
    safeDiv(b.currentAssets.value, b.currentLiabilities.value, 'current ratio'),
    'Current assets ÷ current liabilities',
    [b.currentAssets, b.currentLiabilities],
  );
}

/** FCCR = (EBITDA − unfinanced capex − cash taxes − distributions)
 *        ÷ (cash interest + scheduled principal + lease principal).
 *  Lease principal is always a fixed charge here, independent of the DSCR
 *  debt-service definition. */
export function computeFccr(b: ResolvedBundle, defs: MetricDefinitions): CitedComputation {
  const numerator =
    b.ebitda.value - b.unfinancedCapex.value - b.cashTaxes.value - b.distributions.value;
  const denomInputs = [b.cashInterest, b.scheduledPrincipalLoans, b.leasePrincipal];
  const denominator = denomInputs.reduce((acc, c) => acc + c.value, 0);
  return ratioComp(
    'fccr',
    b,
    safeDiv(numerator, denominator, 'FCCR'),
    '(Covenant EBITDA − unfinanced capex − cash taxes − distributions) ÷ (cash interest + scheduled principal + lease principal)',
    [b.ebitda, b.unfinancedCapex, b.cashTaxes, b.distributions, ...denomInputs],
    defs.capex.clauseRef,
  );
}

export function computeRatio(
  key: RatioKey,
  b: ResolvedBundle,
  defs: MetricDefinitions,
): CitedComputation {
  switch (key) {
    case 'dscr':
      return computeDscr(b, defs);
    case 'leverage':
      return computeLeverage(b, defs);
    case 'icr':
      return computeIcr(b, defs);
    case 'current_ratio':
      return computeCurrentRatio(b, defs);
    case 'fccr':
      return computeFccr(b, defs);
  }
}

export const ALL_RATIO_KEYS: RatioKey[] = ['dscr', 'leverage', 'icr', 'current_ratio', 'fccr'];

export function computeAllRatios(
  b: ResolvedBundle,
  defs: MetricDefinitions,
): Record<RatioKey, CitedComputation> {
  return Object.fromEntries(ALL_RATIO_KEYS.map((k) => [k, computeRatio(k, b, defs)])) as Record<
    RatioKey,
    CitedComputation
  >;
}
