import type { Comparator, RatioKey, StepDown } from './definitions';
import { EngineError } from './errors';
import { nextQuarterLabel } from './periods';
import { clamp, roundToStep } from './rounding';

/**
 * Deterministic covenant-package proposal policy (BEFORE mode). The LLM never
 * picks thresholds; this module does, from computed inputs, under a
 * parameterized policy that a credit committee can review and tune. Every
 * rule is explicit so proposals are reproducible and explainable.
 */
export interface ProposalPolicy {
  /** Market-convention rounding steps. */
  leverageRoundStep: number;
  coverageRoundStep: number;
  /** Opening leverage cap must clear current level by this relative buffer. */
  openingBufferOverCurrent: number;
  /** Quarterly EBITDA coefficient of variation above this counts as high volatility. */
  highVolCovCutoff: number;
  /** Extra leverage cushion granted when volatility is high. */
  highVolExtraLeverageCushion: number;
  leverageCapMax: number;
  dscrFloorMin: number;
  dscrFloorMax: number;
  icrFloorMin: number;
  icrFloorMax: number;
  fccrFloorMin: number;
  fccrFloorMax: number;
  currentFloorMin: number;
  currentFloorMax: number;
  /** Quarters over which the leverage cap steps down to the landing level. */
  stepDownQuarters: number;
  /** Distributions above this share of LTM EBITDA make FCCR worth covenanting. */
  materialDistributionsShare: number;
}

export const DEFAULT_PROPOSAL_POLICY: ProposalPolicy = {
  leverageRoundStep: 0.25,
  coverageRoundStep: 0.05,
  openingBufferOverCurrent: 0.1,
  highVolCovCutoff: 0.12,
  highVolExtraLeverageCushion: 0.25,
  leverageCapMax: 5.0,
  dscrFloorMin: 1.1,
  dscrFloorMax: 1.5,
  icrFloorMin: 1.5,
  icrFloorMax: 3.0,
  fccrFloorMin: 1.0,
  fccrFloorMax: 1.25,
  currentFloorMin: 1.0,
  currentFloorMax: 1.3,
  stepDownQuarters: 8,
  materialDistributionsShare: 0.1,
};

export interface ProposalInputs {
  asOfPeriod: string;
  /** Current ratio levels at the as-of test date. */
  current: Record<RatioKey, number>;
  /** Worst value of each ratio across the stress scenarios that were run. */
  worstStressed: Record<RatioKey, number>;
  /** Quarterly EBITDA coefficient of variation. */
  ebitdaQuarterlyCov: number;
  hasScheduledAmortization: boolean;
  /** Distributions (LTM) ÷ EBITDA (LTM). */
  distributionsShareOfEbitda: number;
}

export interface ProposedCovenant {
  id: string;
  name: string;
  ratio: RatioKey;
  comparator: Comparator;
  threshold: number;
  stepDowns?: StepDown[];
  testBasis: 'ltm' | 'point_in_time';
  frequency: 'quarterly';
  /** Machine-readable rationale tags the composer expands into cited prose. */
  rationaleTags: string[];
  derivedFrom: {
    current: number;
    worstStressed: number;
    volatilityCov: number;
  };
}

export interface ProposedPackage {
  covenants: ProposedCovenant[];
  notes: string[];
  policy: ProposalPolicy;
}

export function proposeCovenantPackage(
  i: ProposalInputs,
  policy: ProposalPolicy = DEFAULT_PROPOSAL_POLICY,
): ProposedPackage {
  for (const [k, v] of [...Object.entries(i.current), ...Object.entries(i.worstStressed)]) {
    if (!Number.isFinite(v)) {
      throw new EngineError(`non-finite proposal input for ${k}`, 'BAD_ARGUMENT');
    }
  }
  const covenants: ProposedCovenant[] = [];
  const notes: string[] = [];
  const highVol = i.ebitdaQuarterlyCov > policy.highVolCovCutoff;

  // ── Leverage cap: survive the worst stress scenario, clear the current level
  // with a buffer, add a volatility cushion when EBITDA is choppy, then glide
  // down to a landing level via step-downs.
  {
    const base = Math.max(
      i.current.leverage * (1 + policy.openingBufferOverCurrent),
      i.worstStressed.leverage,
    );
    const volCushion = highVol ? policy.highVolExtraLeverageCushion : 0;
    const opening = Math.min(
      policy.leverageCapMax,
      roundToStep(base, policy.leverageRoundStep, 'up') + volCushion,
    );
    const landing = Math.min(
      opening,
      roundToStep(
        i.current.leverage * (1 + policy.openingBufferOverCurrent),
        policy.leverageRoundStep,
        'up',
      ),
    );
    const stepDowns: StepDown[] = [];
    if (opening - landing >= policy.leverageRoundStep - 1e-9) {
      const mid = roundToStep((opening + landing) / 2, policy.leverageRoundStep, 'nearest');
      const half = Math.round(policy.stepDownQuarters / 2);
      if (mid < opening - 1e-9 && mid > landing + 1e-9) {
        stepDowns.push({ fromPeriod: nextQuarterLabel(i.asOfPeriod, half), threshold: mid });
      }
      stepDowns.push({
        fromPeriod: nextQuarterLabel(i.asOfPeriod, policy.stepDownQuarters),
        threshold: landing,
      });
    }
    covenants.push({
      id: 'proposed-leverage',
      name: 'Maximum Net Leverage Ratio',
      ratio: 'leverage',
      comparator: 'max',
      threshold: opening,
      stepDowns: stepDowns.length > 0 ? stepDowns : undefined,
      testBasis: 'ltm',
      frequency: 'quarterly',
      rationaleTags: [
        'stress_bound',
        ...(highVol ? ['volatility_cushion'] : []),
        ...(stepDowns.length > 0 ? ['stepdown_glide'] : []),
      ],
      derivedFrom: {
        current: i.current.leverage,
        worstStressed: i.worstStressed.leverage,
        volatilityCov: i.ebitdaQuarterlyCov,
      },
    });
  }

  // ── Coverage: DSCR when debt actually amortizes, otherwise ICR.
  if (i.hasScheduledAmortization) {
    const floor = clamp(
      roundToStep(i.worstStressed.dscr * 0.95, policy.coverageRoundStep, 'down'),
      policy.dscrFloorMin,
      policy.dscrFloorMax,
    );
    covenants.push({
      id: 'proposed-dscr',
      name: 'Minimum Debt Service Coverage Ratio',
      ratio: 'dscr',
      comparator: 'min',
      threshold: floor,
      testBasis: 'ltm',
      frequency: 'quarterly',
      rationaleTags: ['stress_bound', 'amortizing_debt'],
      derivedFrom: {
        current: i.current.dscr,
        worstStressed: i.worstStressed.dscr,
        volatilityCov: i.ebitdaQuarterlyCov,
      },
    });
  } else {
    const floor = clamp(
      roundToStep(i.worstStressed.icr * 0.9, 0.25, 'down'),
      policy.icrFloorMin,
      policy.icrFloorMax,
    );
    covenants.push({
      id: 'proposed-icr',
      name: 'Minimum Interest Coverage Ratio',
      ratio: 'icr',
      comparator: 'min',
      threshold: floor,
      testBasis: 'ltm',
      frequency: 'quarterly',
      rationaleTags: ['stress_bound', 'bullet_debt'],
      derivedFrom: {
        current: i.current.icr,
        worstStressed: i.worstStressed.icr,
        volatilityCov: i.ebitdaQuarterlyCov,
      },
    });
    notes.push('No scheduled amortization detected, so interest coverage replaces DSCR.');
  }

  // ── Liquidity floor.
  {
    const floor = clamp(
      roundToStep(
        Math.min(i.current.current_ratio * 0.85, i.worstStressed.current_ratio),
        policy.coverageRoundStep,
        'down',
      ),
      policy.currentFloorMin,
      policy.currentFloorMax,
    );
    covenants.push({
      id: 'proposed-current',
      name: 'Minimum Current Ratio',
      ratio: 'current_ratio',
      comparator: 'min',
      threshold: floor,
      testBasis: 'point_in_time',
      frequency: 'quarterly',
      rationaleTags: ['liquidity_floor'],
      derivedFrom: {
        current: i.current.current_ratio,
        worstStressed: i.worstStressed.current_ratio,
        volatilityCov: i.ebitdaQuarterlyCov,
      },
    });
  }

  // ── FCCR only when distributions are material enough to threaten fixed charges.
  if (i.distributionsShareOfEbitda > policy.materialDistributionsShare) {
    const floor = clamp(
      roundToStep(i.worstStressed.fccr * 0.9, policy.coverageRoundStep, 'down'),
      policy.fccrFloorMin,
      policy.fccrFloorMax,
    );
    covenants.push({
      id: 'proposed-fccr',
      name: 'Minimum Fixed Charge Coverage Ratio',
      ratio: 'fccr',
      comparator: 'min',
      threshold: floor,
      testBasis: 'ltm',
      frequency: 'quarterly',
      rationaleTags: ['distribution_discipline'],
      derivedFrom: {
        current: i.current.fccr,
        worstStressed: i.worstStressed.fccr,
        volatilityCov: i.ebitdaQuarterlyCov,
      },
    });
    notes.push(
      'Distributions are material relative to EBITDA; pair the FCCR with a restricted-payments basket in the agreement.',
    );
  }

  if (highVol) {
    notes.push(
      'Quarterly EBITDA volatility exceeds the policy cutoff; thresholds carry an extra cushion and testing should stay on an LTM basis to damp seasonality.',
    );
  }

  return { covenants, notes, policy };
}
