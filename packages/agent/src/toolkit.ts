import {
  DEFAULT_PROPOSAL_POLICY,
  EngineError,
  resolveBundle,
  resolveBundleSeries,
  sortQuarters,
  STANDARD_SHOCKS,
  type CovenantSpec,
  type MetricDefinitions,
  type ProposalPolicy,
  type QuarterFinancials,
  type ResolvedBundle,
  type Shock,
} from '@covenant/core';
import type { Retriever } from '@covenant/providers';
import type { z } from 'zod';
import type { AgentMode, RunDataset } from './dataset';
import { FactTable } from './facts';
import { Trace } from './trace';

export interface AgentPolicy {
  /** Headroom below this fraction of the covenant level is flagged "tight". */
  warnHeadroomPct: number;
  /** Standard shock set for stress runs. */
  shocks: Shock[];
  proposal: ProposalPolicy;
  /** Iteration cap for the model-driven tool loop. */
  maxLlmToolIterations: number;
  /** Retrieval score below which a definition lookup is not corroborating. */
  minRetrievalScore: number;
}

export const DEFAULT_AGENT_POLICY: AgentPolicy = {
  warnHeadroomPct: 0.1,
  shocks: STANDARD_SHOCKS,
  proposal: DEFAULT_PROPOSAL_POLICY,
  maxLlmToolIterations: 16,
  minRetrievalScore: 0.05,
};

/** Memoizing wrapper around the engine resolver so tools share bundles. */
export class BundleResolver {
  private readonly cache = new Map<string, ResolvedBundle>();
  private seriesCache: { label: string; bundle: ResolvedBundle }[] | null = null;
  private readonly sorted: QuarterFinancials[];

  constructor(
    quarters: QuarterFinancials[],
    private readonly defs: MetricDefinitions,
  ) {
    this.sorted = sortQuarters(quarters);
  }

  at(label: string): ResolvedBundle {
    const cached = this.cache.get(label);
    if (cached) return cached;
    const bundle = resolveBundle(this.sorted, label, this.defs);
    this.cache.set(label, bundle);
    return bundle;
  }

  series(): { label: string; bundle: ResolvedBundle }[] {
    if (!this.seriesCache) {
      const { bundles } = resolveBundleSeries(this.sorted, this.defs);
      this.seriesCache = bundles;
      for (const { label, bundle } of bundles) this.cache.set(label, bundle);
    }
    return this.seriesCache;
  }

  quarters(): QuarterFinancials[] {
    return this.sorted;
  }
}

/** Everything a tool can touch. Tools are deterministic given services. */
export interface ToolServices {
  mode: AgentMode;
  dataset: RunDataset;
  retriever: Retriever;
  facts: FactTable;
  trace: Trace;
  defs: MetricDefinitions;
  covenants: CovenantSpec[];
  policy: AgentPolicy;
  /** Quarter label of the covenant test period implied by asOfDate. */
  asOfQuarter: string;
  resolver: BundleResolver;
}

export interface ToolOutcome<T = unknown> {
  summary: string;
  factIds: string[];
  data: T;
}

export interface ToolDef<A = unknown, T = unknown> {
  name: string;
  description: string;
  /** JSON Schema advertised to the LLM planner. */
  paramsJsonSchema: Record<string, unknown>;
  /** Runtime validation of arguments (also guards LLM-produced args).
   *  Input is `unknown` because schemas with .default() accept looser input. */
  argsSchema: z.ZodType<A, z.ZodTypeDef, unknown>;
  run(args: A, services: ToolServices): Promise<ToolOutcome<T>>;
}

export class ToolError extends Error {
  constructor(
    message: string,
    readonly tool: string,
    readonly kind: 'invalid_args' | 'execution' = 'execution',
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

export type ToolRegistry = Map<string, ToolDef<never, unknown>>;

/** Every tool call flows through here so the trace is uniform regardless of
 *  who initiated it (scripted orchestrator or model-driven loop). */
export async function executeTool<T = unknown>(
  registry: ToolRegistry,
  name: string,
  rawArgs: unknown,
  services: ToolServices,
): Promise<ToolOutcome<T>> {
  services.trace.checkAborted();
  const def = registry.get(name);
  const callId = services.trace.nextCallId(name);
  if (!def) {
    services.trace.emit({
      type: 'tool_result',
      callId,
      tool: name,
      ok: false,
      summary: 'unknown tool',
      factIds: [],
      error: `tool "${name}" is not registered`,
    });
    throw new ToolError(`tool "${name}" is not registered`, name, 'invalid_args');
  }
  const argsForDisplay =
    rawArgs && typeof rawArgs === 'object' ? (rawArgs as Record<string, unknown>) : { value: rawArgs };
  services.trace.emit({ type: 'tool_call', callId, tool: name, args: argsForDisplay });

  const parsed = def.argsSchema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    services.trace.emit({
      type: 'tool_result',
      callId,
      tool: name,
      ok: false,
      summary: 'invalid arguments',
      factIds: [],
      error: message,
    });
    throw new ToolError(`invalid arguments for ${name}: ${message}`, name, 'invalid_args');
  }

  try {
    const outcome = (await def.run(parsed.data as never, services)) as ToolOutcome<T>;
    services.trace.emit({
      type: 'tool_result',
      callId,
      tool: name,
      ok: true,
      summary: outcome.summary,
      factIds: outcome.factIds,
    });
    return outcome;
  } catch (err) {
    const message =
      err instanceof EngineError
        ? `${err.code}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    services.trace.emit({
      type: 'tool_result',
      callId,
      tool: name,
      ok: false,
      summary: 'tool failed',
      factIds: [],
      error: message,
    });
    if (err instanceof ToolError) throw err;
    throw new ToolError(message, name);
  }
}

export function toolSpecsForLlm(registry: ToolRegistry): {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}[] {
  return [...registry.values()].map((def) => ({
    name: def.name,
    description: def.description,
    parameters: def.paramsJsonSchema,
  }));
}
