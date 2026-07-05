import { defaultDefinitions, latestQuarterOnOrBefore, PRODUCT_DISCLAIMER } from '@covenant/core';
import type { InferenceClient, Retriever } from '@covenant/providers';
import { collectSectionFactIds, type ComposedOutput } from './compose';
import { assessConfidence } from './confidence';
import type { AgentMode, RunDataset } from './dataset';
import { FactTable } from './facts';
import { LlmLoopError, runModelLoop } from './llmLoop';
import { runAfterMode, type ModeResult } from './modes/after';
import { runBeforeMode } from './modes/before';
import { DeterministicPlanner, LlmPlanner, SCRIPTED_PLANS, type Planner } from './planner';
import { RunAbortedError, Trace, type RunResult, type TraceEvent } from './trace';
import { BundleResolver, DEFAULT_AGENT_POLICY, type AgentPolicy, type ToolServices } from './toolkit';
import { makeToolRegistry } from './tools/index';

export interface AgentRunConfig {
  mode: AgentMode;
  runId: string;
  dataset: RunDataset;
  retriever: Retriever;
  /** Why this retriever was selected (shown in the run header). */
  retrieverReason?: string;
  inference: InferenceClient | null;
  policy?: AgentPolicy;
  /** scripted = deterministic control flow (default); model = LLM-driven tool loop. */
  loopMode?: 'scripted' | 'model';
  onEvent?: (event: TraceEvent) => void;
  signal?: AbortSignal;
}

/**
 * Entry point shared by both modes. Wires the dataset into tool services,
 * picks the planner (LLM if Vultr is configured, deterministic otherwise),
 * runs the orchestration and closes the trace with a RunResult.
 */
export async function runAgent(cfg: AgentRunConfig): Promise<RunResult> {
  const trace = new Trace(cfg.runId, cfg.onEvent, cfg.signal);
  const startedAt = Date.now();
  const policy = cfg.policy ?? DEFAULT_AGENT_POLICY;
  const requestedLoopMode = cfg.loopMode ?? 'scripted';

  try {
    const { dataset } = cfg;
    if (cfg.mode === 'after' && !dataset.agreement) {
      throw new Error('AFTER mode requires a credit agreement in the dataset');
    }
    const defs =
      cfg.mode === 'after' && dataset.agreement ? dataset.agreement.definitions : defaultDefinitions();
    const covenants = cfg.mode === 'after' && dataset.agreement ? dataset.agreement.covenants : [];
    const asOfQuarter = latestQuarterOnOrBefore(dataset.quarters, dataset.asOfDate).period.label;

    const planner: Planner =
      cfg.inference?.isConfigured() === true ? new LlmPlanner(cfg.inference) : new DeterministicPlanner();
    const loopMode: 'scripted' | 'model' =
      requestedLoopMode === 'model' && cfg.inference?.isConfigured() === true ? 'model' : 'scripted';
    if (requestedLoopMode === 'model' && loopMode !== 'model') {
      trace.warning('AGENT_LOOP_MODE=model requires a configured inference provider; using the scripted loop');
    }

    const services: ToolServices = {
      mode: cfg.mode,
      dataset,
      retriever: cfg.retriever,
      facts: new FactTable(),
      trace,
      defs,
      covenants,
      policy,
      asOfQuarter,
      resolver: new BundleResolver(dataset.quarters, defs),
    };
    const registry = makeToolRegistry();

    trace.emit({
      type: 'run_started',
      mode: cfg.mode,
      companyName: dataset.company.name,
      asOf: dataset.asOfDate,
      asOfQuarter,
      planner: planner.kind,
      loopMode,
      retriever: cfg.retrieverReason ?? cfg.retriever.kind,
      provider: cfg.inference?.isConfigured() ? cfg.inference.providerName : 'offline (no inference provider)',
    });

    const steps = await planner.plan(cfg.mode, SCRIPTED_PLANS[cfg.mode]);
    trace.emit({ type: 'plan_created', steps });

    let modeResult: ModeResult;
    if (loopMode === 'model' && cfg.inference) {
      try {
        const sections = await runModelLoop(services, planner, cfg.inference, registry);
        const overall = assessConfidence({
          mode: cfg.mode,
          definitionSource: cfg.mode === 'after' ? 'agreement_verbatim' : 'default_template',
          retrievalCorroborated: null,
          dataFresh: !dataset.freshness.stale,
          missingInputs: [],
          derivedFallbacks: [],
          crossChecksConsistent: null,
          llmSampleAgreement: null,
        });
        for (const section of sections) {
          const facts: Record<string, import('./facts').Fact> = {};
          for (const id of collectSectionFactIds(section)) {
            const fact = services.facts.get(id);
            if (fact) facts[id] = fact;
          }
          trace.emit({ type: 'output_section', section, facts });
        }
        const output: ComposedOutput = {
          kind: cfg.mode === 'after' ? 'escalation_memo' : 'term_sheet',
          title: `${cfg.mode === 'after' ? 'Covenant Escalation Memo' : 'Covenant Design Term Sheet'} — ${dataset.company.name}`,
          companyName: dataset.company.name,
          asOf: dataset.asOfDate,
          basisNote: `Test period ${asOfQuarter} · model-driven loop (experimental)`,
          disclaimer: PRODUCT_DISCLAIMER,
          sections,
        };
        modeResult = { output, overall, needsHumanReview: overall.level === 'LOW' };
      } catch (err) {
        if (err instanceof RunAbortedError) throw err;
        const message = err instanceof LlmLoopError ? err.message : String(err);
        trace.warning(`model-driven loop failed (${message}); re-running with the scripted orchestrator`);
        modeResult =
          cfg.mode === 'after'
            ? await runAfterMode(services, planner, registry, steps)
            : await runBeforeMode(services, planner, registry, steps);
      }
    } else {
      modeResult =
        cfg.mode === 'after'
          ? await runAfterMode(services, planner, registry, steps)
          : await runBeforeMode(services, planner, registry, steps);
    }

    const result: RunResult = {
      output: modeResult.output,
      overallConfidence: modeResult.overall,
      needsHumanReview: modeResult.needsHumanReview,
      factCount: services.facts.size(),
      durationMs: Date.now() - startedAt,
      planner: planner.kind,
      loopMode,
    };
    trace.emit({ type: 'run_completed', result });
    return result;
  } catch (err) {
    if (err instanceof RunAbortedError) {
      trace.emit({ type: 'error', message: 'run cancelled by the client' });
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    trace.emit({ type: 'error', message });
    throw err;
  }
}
