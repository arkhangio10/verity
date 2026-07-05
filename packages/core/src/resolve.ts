import type { CitedComputation, CitedNode, CitedValue } from './citations';
import type { MetricDefinitions } from './definitions';
import { EngineError, last } from './errors';
import { compareQuarters, quarterIndex } from './periods';
import type { CanonicalFieldPath, QuarterFinancials } from './statements';
import { getField } from './statements';
import { assertSameUnit, moneyUnit, PERCENT_UNIT, type Unit } from './units';

/**
 * The resolver is the bridge between raw (cited) statement lines and ratio
 * math. Given quarterly financials and a set of contract definitions it
 * produces a ResolvedBundle: every metric a covenant ratio needs, as a
 * CitedComputation tree whose leaves point back into source documents.
 * Flow metrics are aggregated over a trailing-twelve-month (LTM) window;
 * stock metrics come from the latest balance sheet.
 */
export interface ResolvedBundle {
  periodLabel: string;
  basis: 'ltm';
  currency: string;
  scale: number;
  window: string[];
  ebitda: CitedComputation;
  ebit: CitedComputation;
  cashTaxes: CitedComputation;
  /** Interest for debt-service purposes, basis per DebtServiceDefinition. */
  cashInterest: CitedComputation;
  /** Accrual interest expense (income statement), used by ICR. */
  interestExpense: CitedComputation;
  scheduledPrincipalLoans: CitedComputation;
  leasePrincipal: CitedComputation;
  totalDebt: CitedComputation;
  netDebt: CitedComputation;
  cash: CitedValue;
  currentAssets: CitedValue;
  currentLiabilities: CitedValue;
  unfinancedCapex: CitedComputation;
  distributions: CitedComputation;
  floatingRateDebt: CitedComputation;
  /** Optional inputs that were absent and defaulted to zero, for confidence. */
  missingOptional: string[];
}

const LTM_QUARTERS = 4;

export function sortQuarters(quarters: QuarterFinancials[]): QuarterFinancials[] {
  return [...quarters].sort((a, b) => compareQuarters(a.period.label, b.period.label));
}

/** Latest quarter whose period end is on or before the as-of date. */
export function latestQuarterOnOrBefore(
  quarters: QuarterFinancials[],
  asOfDateISO: string,
): QuarterFinancials {
  const eligible = sortQuarters(quarters).filter((q) => q.period.endDate <= asOfDateISO);
  if (eligible.length === 0) {
    throw new EngineError(`no quarter ends on or before ${asOfDateISO}`, 'INSUFFICIENT_HISTORY');
  }
  return last(eligible, 'eligible quarters');
}

/** The four consecutive quarters ending at `asOfLabel`. */
export function ltmWindow(quarters: QuarterFinancials[], asOfLabel: string): QuarterFinancials[] {
  const sorted = sortQuarters(quarters).filter(
    (q) => quarterIndex(q.period.label) <= quarterIndex(asOfLabel),
  );
  if (sorted.length < LTM_QUARTERS) {
    throw new EngineError(
      `need ${LTM_QUARTERS} quarters ending at ${asOfLabel}, have ${sorted.length}`,
      'INSUFFICIENT_HISTORY',
      { asOfLabel },
    );
  }
  const window = sorted.slice(-LTM_QUARTERS);
  const lastQ = last(window, 'ltm window');
  if (lastQ.period.label !== asOfLabel) {
    throw new EngineError(
      `quarter ${asOfLabel} not present (latest available is ${lastQ.period.label})`,
      'INSUFFICIENT_HISTORY',
    );
  }
  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1];
    const cur = window[i];
    if (!prev || !cur) continue;
    if (quarterIndex(cur.period.label) !== quarterIndex(prev.period.label) + 1) {
      throw new EngineError(
        `LTM window has a gap: ${prev.period.label} → ${cur.period.label}`,
        'INSUFFICIENT_HISTORY',
      );
    }
  }
  return window;
}

function bundleUnit(window: QuarterFinancials[]): Unit {
  const q0 = window[0];
  if (!q0) throw new EngineError('empty LTM window', 'BAD_ARGUMENT');
  const unit = moneyUnit(q0.currency, q0.scale);
  for (const q of window) assertSameUnit(unit, moneyUnit(q.currency, q.scale), 'LTM window');
  return unit;
}

function requireCV(q: QuarterFinancials, path: CanonicalFieldPath): CitedValue {
  const v = getField(q, path);
  if (!v) {
    throw new EngineError(`missing required input ${path} for ${q.period.label}`, 'MISSING_INPUT', {
      path,
      period: q.period.label,
    });
  }
  return v;
}

interface SumOptions {
  id: string;
  label: string;
  required: boolean;
  missingOptional: string[];
  definitionSource?: CitedComputation['definitionSource'];
}

/** Sum a statement line across the LTM window into one cited computation. */
function sumQuarters(
  window: QuarterFinancials[],
  path: CanonicalFieldPath,
  opts: SumOptions,
): CitedComputation {
  const unit = bundleUnit(window);
  const inputs: CitedNode[] = [];
  const notes: string[] = [];
  let total = 0;
  let found = 0;
  for (const q of window) {
    const v = opts.required ? requireCV(q, path) : getField(q, path);
    if (!v) {
      notes.push(`${path} not reported for ${q.period.label}; treated as 0`);
      continue;
    }
    assertSameUnit(unit, v.unit, `${path} @ ${q.period.label}`);
    total += v.value;
    found += 1;
    inputs.push(v);
  }
  if (!opts.required && found === 0) {
    opts.missingOptional.push(path);
  }
  const lastQ = last(window, 'ltm window');
  return {
    kind: 'computation',
    id: `${opts.id}:${lastQ.period.label}`,
    label: opts.label,
    value: total,
    unit,
    period: lastQ.period.label,
    formula: 'Sum of trailing four quarters',
    inputs,
    definitionSource: opts.definitionSource,
    notes,
  };
}

function resolveEbitda(
  window: QuarterFinancials[],
  defs: MetricDefinitions,
  missingOptional: string[],
): CitedComputation {
  const unit = bundleUnit(window);
  const lastQ = last(window, 'ltm window');
  const period = lastQ.period.label;
  const opProfit = sumQuarters(window, 'income.operatingProfit', {
    id: 'ebitda.operating-profit',
    label: 'Operating profit (LTM)',
    required: true,
    missingOptional,
  });
  const da = sumQuarters(window, 'income.depreciationAmortization', {
    id: 'ebitda.d-and-a',
    label: 'Depreciation & amortization (LTM)',
    required: true,
    missingOptional,
  });

  const addBackComps: CitedComputation[] = [];
  const notes: string[] = [];
  for (const ab of defs.ebitda.addBacks) {
    if (ab.key === 'stockCompensation') {
      const comp = sumQuarters(window, 'income.stockCompensation', {
        id: 'ebitda.addback.stock-comp',
        label: `Add-back: ${ab.description}`,
        required: false,
        missingOptional,
        definitionSource: ab.clauseRef,
      });
      addBackComps.push(applyAddBackCap(comp, ab.capPerLtm));
    } else {
      const items: CitedValue[] = window.flatMap((q) => q.income.oneTimeItems ?? []);
      for (const item of items) assertSameUnit(unit, item.unit, 'one-time item');
      const raw = items.reduce((acc, v) => acc + v.value, 0);
      const comp: CitedComputation = {
        kind: 'computation',
        id: `ebitda.addback.one-time:${period}`,
        label: `Add-back: ${ab.description}`,
        value: raw,
        unit,
        period,
        formula: 'Sum of eligible one-time items in the LTM window',
        inputs: items,
        definitionSource: ab.clauseRef,
        notes: items.length === 0 ? ['no one-time items reported in window'] : [],
      };
      addBackComps.push(applyAddBackCap(comp, ab.capPerLtm));
    }
  }

  const value = opProfit.value + da.value + addBackComps.reduce((acc, c) => acc + c.value, 0);
  return {
    kind: 'computation',
    id: `ebitda:${period}`,
    label: defs.ebitda.name,
    value,
    unit,
    period,
    formula:
      'Operating profit + depreciation & amortization' +
      (addBackComps.length > 0 ? ' + permitted add-backs' : '') +
      ' (LTM)',
    inputs: [opProfit, da, ...addBackComps],
    definitionSource: defs.ebitda.clauseRef,
    notes,
  };
}

function applyAddBackCap(comp: CitedComputation, capPerLtm?: number): CitedComputation {
  if (capPerLtm === undefined || comp.value <= capPerLtm) return comp;
  return {
    ...comp,
    value: capPerLtm,
    notes: [
      ...comp.notes,
      `add-back capped at ${capPerLtm} per LTM period (uncapped amount: ${comp.value})`,
    ],
  };
}

function resolveTotalDebt(
  latest: QuarterFinancials,
  defs: MetricDefinitions,
): CitedComputation {
  const unit = moneyUnit(latest.currency, latest.scale);
  const period = latest.period.label;
  // Lease liabilities are optional: a company without leases simply reports
  // none — that is a zero, not a missing input. Core borrowings stay required.
  const parts: { path: CanonicalFieldPath; include: boolean; optional?: boolean }[] = [
    { path: 'balance.shortTermBorrowings', include: defs.debt.includeShortTermBorrowings },
    { path: 'balance.currentPortionLongTermDebt', include: defs.debt.includeCurrentPortionLongTermDebt },
    { path: 'balance.longTermDebt', include: defs.debt.includeLongTermDebt },
    { path: 'balance.leaseLiabilitiesCurrent', include: defs.debt.includeLeaseLiabilities, optional: true },
    { path: 'balance.leaseLiabilitiesNonCurrent', include: defs.debt.includeLeaseLiabilities, optional: true },
  ];
  const inputs: CitedValue[] = [];
  const extraNotes: string[] = [];
  let total = 0;
  for (const part of parts) {
    if (!part.include) continue;
    const v = part.optional ? getField(latest, part.path) : requireCV(latest, part.path);
    if (!v) {
      extraNotes.push(`${part.path} not reported; treated as 0`);
      continue;
    }
    assertSameUnit(unit, v.unit, part.path);
    total += v.value;
    inputs.push(v);
  }
  const notes = [
    defs.debt.includeLeaseLiabilities
      ? 'lease liabilities (IFRS 16 / NIIF 16) included per definition'
      : 'lease liabilities (IFRS 16 / NIIF 16) excluded per definition',
    ...extraNotes,
  ];
  return {
    kind: 'computation',
    id: `total-debt:${period}`,
    label: defs.debt.name,
    value: total,
    unit,
    period,
    formula: 'Sum of included interest-bearing liabilities at period end',
    inputs,
    definitionSource: defs.debt.clauseRef,
    notes,
  };
}

export function resolveBundle(
  quarters: QuarterFinancials[],
  asOfLabel: string,
  defs: MetricDefinitions,
): ResolvedBundle {
  const window = ltmWindow(quarters, asOfLabel);
  const latest = last(window, 'ltm window');
  const unit = bundleUnit(window);
  const missingOptional: string[] = [];
  const period = latest.period.label;

  const ebitda = resolveEbitda(window, defs, missingOptional);
  const ebit = sumQuarters(window, 'income.operatingProfit', {
    id: 'ebit',
    label: 'EBIT (operating profit, LTM)',
    required: true,
    missingOptional,
  });
  const cashTaxes = sumQuarters(
    window,
    defs.cashTaxes.source,
    {
      id: 'cash-taxes',
      label:
        defs.cashTaxes.source === 'cashflow.cashTaxesPaid'
          ? 'Cash taxes paid (LTM)'
          : 'Tax expense (LTM, per definition)',
      required: true,
      missingOptional,
      definitionSource: defs.cashTaxes.clauseRef,
    },
  );
  const cashInterest = sumQuarters(
    window,
    defs.debtService.interestBasis === 'cash'
      ? 'cashflow.cashInterestPaid'
      : 'income.interestExpense',
    {
      id: 'debt-service-interest',
      label:
        defs.debtService.interestBasis === 'cash'
          ? 'Cash interest paid (LTM)'
          : 'Interest expense (LTM, accrual per definition)',
      required: true,
      missingOptional,
      definitionSource: defs.debtService.clauseRef,
    },
  );
  const interestExpense = sumQuarters(window, 'income.interestExpense', {
    id: 'interest-expense',
    label: 'Interest expense (LTM)',
    required: true,
    missingOptional,
  });
  const scheduledPrincipalLoans = sumQuarters(window, 'cashflow.scheduledPrincipalPayments', {
    id: 'scheduled-principal',
    label: 'Scheduled principal payments (LTM)',
    required: true,
    missingOptional,
    definitionSource: defs.debtService.clauseRef,
  });
  const leasePrincipal = sumQuarters(window, 'cashflow.leasePrincipalPayments', {
    id: 'lease-principal',
    label: 'Lease principal payments (LTM)',
    required: false,
    missingOptional,
  });

  const totalDebt = resolveTotalDebt(latest, defs);
  const cash = requireCV(latest, 'balance.cashAndEquivalents');
  const netDebt: CitedComputation = {
    kind: 'computation',
    id: `net-debt:${period}`,
    label: 'Net Debt',
    value: totalDebt.value - cash.value,
    unit,
    period,
    formula: 'Total Debt − cash & equivalents',
    inputs: [totalDebt, cash],
    definitionSource: defs.debt.clauseRef,
    notes: [],
  };

  const grossCapex = sumQuarters(window, 'cashflow.capitalExpenditures', {
    id: 'capex-gross',
    label: 'Capital expenditures (LTM, gross)',
    required: true,
    missingOptional,
  });
  const financed = sumQuarters(window, 'cashflow.leaseFinancedCapex', {
    id: 'capex-financed',
    label: 'Lease/vendor-financed capex (LTM)',
    required: false,
    missingOptional,
  });
  const unfinancedCapex: CitedComputation =
    defs.capex.basis === 'gross'
      ? { ...grossCapex, id: `capex:${period}`, label: 'Capital expenditures (LTM, per definition: gross)', definitionSource: defs.capex.clauseRef }
      : {
          kind: 'computation',
          id: `capex:${period}`,
          label: 'Unfinanced capital expenditures (LTM)',
          value: grossCapex.value - financed.value,
          unit,
          period,
          formula: 'Gross capex − lease/vendor-financed capex',
          inputs: [grossCapex, financed],
          definitionSource: defs.capex.clauseRef,
          notes: [],
        };

  const distributions = sumQuarters(window, 'cashflow.distributionsToOwners', {
    id: 'distributions',
    label: 'Distributions to owners (LTM)',
    required: false,
    missingOptional,
  });

  const share = latest.extras?.floatingRateDebtShare;
  const floatingRateDebt: CitedComputation = share
    ? {
        kind: 'computation',
        id: `floating-debt:${period}`,
        label: 'Floating-rate debt (estimated)',
        value: totalDebt.value * share.value,
        unit,
        period,
        formula: 'Total Debt × disclosed floating-rate share',
        inputs: [totalDebt, share],
        notes: [],
      }
    : {
        kind: 'computation',
        id: `floating-debt:${period}`,
        label: 'Floating-rate debt (estimated)',
        value: 0,
        unit,
        period,
        formula: 'Total Debt × disclosed floating-rate share',
        inputs: [totalDebt],
        notes: ['floating-rate share not disclosed; rate shocks will assume all-fixed debt'],
      };
  if (!share) missingOptional.push('extras.floatingRateDebtShare');

  return {
    periodLabel: period,
    basis: 'ltm',
    currency: latest.currency,
    scale: latest.scale,
    window: window.map((q) => q.period.label),
    ebitda,
    ebit,
    cashTaxes,
    cashInterest,
    interestExpense,
    scheduledPrincipalLoans,
    leasePrincipal,
    totalDebt,
    netDebt,
    cash,
    currentAssets: requireCV(latest, 'balance.currentAssets'),
    currentLiabilities: requireCV(latest, 'balance.currentLiabilities'),
    unfinancedCapex,
    distributions,
    floatingRateDebt,
    missingOptional,
  };
}

export interface BundleSeries {
  bundles: { label: string; bundle: ResolvedBundle }[];
  warnings: string[];
}

/** Resolve a bundle at every quarter with a complete LTM window. Quarters that
 *  fail (missing inputs, gaps) are skipped and reported, not silently dropped. */
export function resolveBundleSeries(
  quarters: QuarterFinancials[],
  defs: MetricDefinitions,
): BundleSeries {
  const sorted = sortQuarters(quarters);
  const bundles: { label: string; bundle: ResolvedBundle }[] = [];
  const warnings: string[] = [];
  for (const q of sorted) {
    const label = q.period.label;
    try {
      bundles.push({ label, bundle: resolveBundle(sorted, label, defs) });
    } catch (err) {
      if (err instanceof EngineError && err.code === 'INSUFFICIENT_HISTORY') continue;
      warnings.push(`could not resolve ${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { bundles, warnings };
}

export { PERCENT_UNIT };
