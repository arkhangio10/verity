import type { TraceEvent } from '@covenant/agent';

export interface StoredRun {
  runId: string;
  mode: string;
  startedAt: string;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  events: TraceEvent[];
}

const MAX_RUNS = 50;

/** In-memory run history so a reloaded client can replay a trace. Swappable
 *  for a database without touching the agent (events are plain JSON). */
class RunStore {
  private readonly runs = new Map<string, StoredRun>();

  create(runId: string, mode: string): StoredRun {
    const run: StoredRun = {
      runId,
      mode,
      startedAt: new Date().toISOString(),
      status: 'running',
      events: [],
    };
    this.runs.set(runId, run);
    if (this.runs.size > MAX_RUNS) {
      const oldest = this.runs.keys().next().value;
      if (oldest !== undefined) this.runs.delete(oldest);
    }
    return run;
  }

  append(runId: string, event: TraceEvent): void {
    const run = this.runs.get(runId);
    if (!run) return;
    run.events.push(event);
    if (event.type === 'run_completed') run.status = 'completed';
    if (event.type === 'error') {
      run.status = event.message.includes('cancelled') ? 'cancelled' : 'error';
    }
  }

  get(runId: string): StoredRun | undefined {
    return this.runs.get(runId);
  }

  list(): Pick<StoredRun, 'runId' | 'mode' | 'startedAt' | 'status'>[] {
    return [...this.runs.values()].map(({ runId, mode, startedAt, status }) => ({
      runId,
      mode,
      startedAt,
      status,
    }));
  }
}

// Survives HMR in dev via globalThis.
const globalStore = globalThis as unknown as { __covenantRunStore?: RunStore };
export const runStore: RunStore = globalStore.__covenantRunStore ?? new RunStore();
globalStore.__covenantRunStore = runStore;
