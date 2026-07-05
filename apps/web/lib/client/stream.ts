import type { TraceEvent } from '@covenant/agent';

/** POST the run request and parse the SSE stream (fetch-based because
 *  EventSource cannot POST). Calls onEvent for every trace event. */
export async function streamAgentRun(
  mode: 'before' | 'after',
  onEvent: (event: TraceEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/agent/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`agent run failed: HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep = buffer.indexOf('\n\n');
    while (sep >= 0) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of frame.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            onEvent(JSON.parse(line.slice(6)) as TraceEvent);
          } catch {
            // tolerate malformed frames rather than killing the stream
          }
        }
      }
      sep = buffer.indexOf('\n\n');
    }
  }
}
