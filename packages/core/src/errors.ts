export type EngineErrorCode =
  | 'MISSING_INPUT'
  | 'UNIT_MISMATCH'
  | 'INSUFFICIENT_HISTORY'
  | 'DIV_BY_ZERO'
  | 'BAD_DEFINITION'
  | 'BAD_PERIOD'
  | 'BAD_ARGUMENT';

/** Typed error thrown by the deterministic engine. Never swallowed silently:
 *  the agent layer converts these into trace events and confidence penalties. */
export class EngineError extends Error {
  constructor(
    message: string,
    readonly code: EngineErrorCode,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

export function first<T>(arr: readonly T[], context = 'array'): T {
  const v = arr[0];
  if (v === undefined) throw new EngineError(`${context} is empty`, 'BAD_ARGUMENT');
  return v;
}

export function last<T>(arr: readonly T[], context = 'array'): T {
  const v = arr[arr.length - 1];
  if (v === undefined) throw new EngineError(`${context} is empty`, 'BAD_ARGUMENT');
  return v;
}
