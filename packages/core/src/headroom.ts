import type { Comparator, CovenantSpec, RatioKey } from './definitions';
import { thresholdForPeriod } from './definitions';

export type HeadroomStatus = 'compliant' | 'tight' | 'breach';

export interface Headroom {
  covenantId: string;
  covenantName: string;
  ratio: RatioKey;
  comparator: Comparator;
  threshold: number;
  actual: number;
  /** Absolute cushion: distance from the covenant level, positive = compliant. */
  cushion: number;
  /** cushion ÷ covenant level. */
  headroomPct: number;
  status: HeadroomStatus;
  warnBelowPct: number;
  periodLabel: string;
}

export const DEFAULT_WARN_HEADROOM_PCT = 0.1;

/** Headroom math. For a maximum-type covenant (e.g. leverage ≤ 3.50×) the
 *  cushion is threshold − actual; for a minimum-type (e.g. DSCR ≥ 1.25×) it is
 *  actual − threshold. Percentage headroom is cushion over the covenant level. */
export function computeHeadroom(
  actual: number,
  spec: CovenantSpec,
  periodLabel: string,
  warnBelowPct = DEFAULT_WARN_HEADROOM_PCT,
): Headroom {
  const threshold = thresholdForPeriod(spec, periodLabel);
  const cushion = spec.comparator === 'max' ? threshold - actual : actual - threshold;
  const headroomPct = cushion / Math.abs(threshold);
  const status: HeadroomStatus =
    cushion < -1e-9 ? 'breach' : headroomPct < warnBelowPct ? 'tight' : 'compliant';
  return {
    covenantId: spec.id,
    covenantName: spec.name,
    ratio: spec.ratio,
    comparator: spec.comparator,
    threshold,
    actual,
    cushion,
    headroomPct,
    status,
    warnBelowPct,
    periodLabel,
  };
}
