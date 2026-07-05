import type { ComposedOutput, OutputSection } from './compose';
import type { ConfidenceAssessment, ConfidenceLevel } from './confidence';
import type { AgentMode } from './dataset';
import type { Fact } from './facts';

export type PlannerKind = 'deterministic' | 'llm';

export interface PlanStep {
  id: string;
  title: string;
  description: string;
}

export interface RetrievalHitSummary {
  docId: string;
  docTitle: string;
  sectionId: string;
  sectionTitle: string;
  score: number;
  snippet: string;
}

export interface RunResult {
  output: ComposedOutput;
  overallConfidence: ConfidenceAssessment;
  needsHumanReview: boolean;
  factCount: number;
  durationMs: number;
  planner: PlannerKind;
  loopMode: 'scripted' | 'model';
}

/**
 * The reasoning trace is a first-class product surface, not a log. Every
 * plan, retrieval, tool call, decision and confidence assessment is emitted
 * as a structured event that the UI streams live.
 */
export type TraceEventBody =
  | {
      type: 'run_started';
      mode: AgentMode;
      companyName: string;
      asOf: string;
      asOfQuarter: string;
      planner: PlannerKind;
      loopMode: 'scripted' | 'model';
      retriever: string;
      provider: string;
    }
  | { type: 'plan_created'; steps: PlanStep[] }
  | { type: 'step_started'; stepId: string; title: string }
  | { type: 'step_completed'; stepId: string }
  | { type: 'note'; stepId?: string; text: string; author: 'agent' | 'llm' }
  | { type: 'retrieval'; stepId?: string; query: string; retriever: string; hits: RetrievalHitSummary[] }
  | { type: 'tool_call'; stepId?: string; callId: string; tool: string; args: Record<string, unknown> }
  | {
      type: 'tool_result';
      stepId?: string;
      callId: string;
      tool: string;
      ok: boolean;
      summary: string;
      factIds: string[];
      error?: string;
    }
  | { type: 'decision'; stepId?: string; title: string; detail: string; severity: 'info' | 'warning' | 'critical' }
  | { type: 'confidence'; stepId?: string; subject: string; level: ConfidenceLevel; justification: string }
  | { type: 'output_section'; section: OutputSection; facts: Record<string, Fact> }
  | { type: 'warning'; text: string }
  | { type: 'error'; message: string }
  | { type: 'run_completed'; result: RunResult };

export type TraceEvent = TraceEventBody & { seq: number; ts: string; runId: string };

export class RunAbortedError extends Error {
  constructor() {
    super('run aborted');
    this.name = 'RunAbortedError';
  }
}

export class Trace {
  readonly events: TraceEvent[] = [];
  private seq = 0;
  private callCounter = 0;
  private currentStepId: string | undefined;

  constructor(
    readonly runId: string,
    private readonly onEvent?: (event: TraceEvent) => void,
    private readonly signal?: AbortSignal,
  ) {}

  emit(body: TraceEventBody): TraceEvent {
    const withStep =
      'stepId' in body && body.stepId === undefined && this.currentStepId !== undefined
        ? { ...body, stepId: this.currentStepId }
        : body;
    const event: TraceEvent = {
      ...withStep,
      seq: this.seq++,
      ts: new Date().toISOString(),
      runId: this.runId,
    };
    this.events.push(event);
    this.onEvent?.(event);
    return event;
  }

  beginStep(step: PlanStep): void {
    this.checkAborted();
    this.currentStepId = step.id;
    this.emit({ type: 'step_started', stepId: step.id, title: step.title });
  }

  endStep(): void {
    if (this.currentStepId !== undefined) {
      this.emit({ type: 'step_completed', stepId: this.currentStepId });
      this.currentStepId = undefined;
    }
  }

  note(text: string, author: 'agent' | 'llm' = 'agent'): void {
    this.emit({ type: 'note', text, author, stepId: this.currentStepId });
  }

  decision(title: string, detail: string, severity: 'info' | 'warning' | 'critical' = 'info'): void {
    this.emit({ type: 'decision', title, detail, severity, stepId: this.currentStepId });
  }

  warning(text: string): void {
    this.emit({ type: 'warning', text });
  }

  nextCallId(tool: string): string {
    this.callCounter += 1;
    return `${tool}#${this.callCounter}`;
  }

  get stepId(): string | undefined {
    return this.currentStepId;
  }

  checkAborted(): void {
    if (this.signal?.aborted) throw new RunAbortedError();
  }
}
