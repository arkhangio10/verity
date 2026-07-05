import { runAgent, RunAbortedError, type TraceEvent } from '@covenant/agent';
import { runStore } from '../../../../lib/server/runStore';
import { getRuntime, getRunContext } from '../../../../lib/server/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/agent/run {mode, session} → text/event-stream of TraceEvents.
 *  The live reasoning trace is the product; this endpoint streams every
 *  plan/retrieval/tool/decision event as it happens. The run operates over the
 *  base case merged with any documents this session uploaded. */
export async function POST(req: Request): Promise<Response> {
  let mode: 'before' | 'after' = 'after';
  let sessionId = 'default';
  let companyId: string | undefined;
  try {
    const body = (await req.json()) as { mode?: string; session?: string; companyId?: string };
    if (body.mode === 'before' || body.mode === 'after') mode = body.mode;
    if (typeof body.session === 'string' && body.session) sessionId = body.session;
    if (typeof body.companyId === 'string' && body.companyId) companyId = body.companyId;
  } catch {
    // default mode
  }

  const app = await getRuntime();
  const ctx = await getRunContext(sessionId, companyId);
  const runId = crypto.randomUUID();
  runStore.create(runId, mode);

  const abort = new AbortController();
  req.signal.addEventListener('abort', () => abort.abort());
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed by cancel()
          }
        }
      };
      const send = (event: TraceEvent) => {
        runStore.append(runId, event);
        if (closed || abort.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          abort.abort();
        }
      };

      void runAgent({
        mode,
        runId,
        dataset: ctx.dataset,
        retriever: ctx.retriever,
        retrieverReason: ctx.retrieverReason,
        inference: app.inference,
        loopMode: app.loopMode,
        signal: abort.signal,
        onEvent: send,
      })
        .catch((err: unknown) => {
          // runAgent already emitted an error event; nothing further to send.
          if (!(err instanceof RunAbortedError)) {
            console.error(`[agent:${runId}]`, err);
          }
        })
        .finally(close);
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Run-Id': runId,
    },
  });
}
