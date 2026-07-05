import { EngineError } from './errors';

export interface PeriodMeta {
  /** Canonical quarter label, e.g. "2026-Q1". */
  label: string;
  startDate: string;
  endDate: string;
  /** Filing/publication date, used for staleness checks. */
  filedAt?: string;
}

const QUARTER_RE = /^(\d{4})-Q([1-4])$/;

/** Monotonic index of a quarter label; consecutive quarters differ by 1. */
export function quarterIndex(label: string): number {
  const m = QUARTER_RE.exec(label);
  if (!m) throw new EngineError(`invalid quarter label "${label}"`, 'BAD_PERIOD');
  return Number(m[1]) * 4 + (Number(m[2]) - 1);
}

export function quarterLabelFromIndex(index: number): string {
  const year = Math.floor(index / 4);
  const q = (index % 4) + 1;
  return `${year}-Q${q}`;
}

export function nextQuarterLabel(label: string, n = 1): string {
  return quarterLabelFromIndex(quarterIndex(label) + n);
}

export function compareQuarters(a: string, b: string): number {
  return quarterIndex(a) - quarterIndex(b);
}

export function daysBetween(fromISO: string, toISO: string): number {
  const from = Date.parse(fromISO);
  const to = Date.parse(toISO);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    throw new EngineError(`invalid ISO dates: ${fromISO} .. ${toISO}`, 'BAD_ARGUMENT');
  }
  return Math.round((to - from) / 86_400_000);
}
