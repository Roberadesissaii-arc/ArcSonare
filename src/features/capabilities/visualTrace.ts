/**
 * What actually happened between "show me the Book folder" and a border.
 *
 * When a border lands in the wrong place there are at least four candidate
 * culprits — the wrong screenshot, the wrong object recognised, the geometry
 * parsed wrongly, or the mapping onto the desktop — and from the outside they
 * look identical. Guessing between them wastes a session. Recording each stage
 * under one correlation id makes the answer readable.
 *
 * Metadata only: no screenshot bytes, no page contents, no transcripts.
 */

export interface VisualTraceStage {
  at: number;
  stage: string;
  detail: Record<string, unknown>;
}

export interface VisualTrace {
  correlationId: string;
  requestId?: string;
  planId?: string;
  runId?: string;
  userRequest: string;
  startedAt: number;
  stages: VisualTraceStage[];
}

const MAX_TRACES = 8;
let traces: VisualTrace[] = [];

export function beginTrace(
  correlationId: string,
  userRequest: string,
  ids: { requestId?: string; planId?: string; runId?: string } = {},
): void {
  traces = [
    {
      correlationId,
      userRequest: userRequest.slice(0, 200),
      startedAt: Date.now(),
      stages: [],
      ...ids,
    },
    ...traces.filter((t) => t.correlationId !== correlationId),
  ].slice(0, MAX_TRACES);
}

export function traceStage(
  correlationId: string,
  stage: string,
  detail: Record<string, unknown>,
): void {
  const trace = traces.find((t) => t.correlationId === correlationId);
  if (!trace) return;
  trace.stages.push({ at: Date.now(), stage, detail });
}

export function getTrace(correlationId: string): VisualTrace | undefined {
  return traces.find((t) => t.correlationId === correlationId);
}

export function recentTraces(): VisualTrace[] {
  return traces;
}

export function clearTraces(): void {
  traces = [];
}

/**
 * Render a trace as readable lines for a diagnostics pane or the console.
 *
 * Reading the raw objects works but is slow; the point of the trace is that the
 * stage where things went wrong should be obvious at a glance.
 */
export function formatTrace(trace: VisualTrace): string[] {
  const lines = [
    `visual trace ${trace.correlationId}`,
    `  request: "${trace.userRequest}"`,
    `  ids: request=${trace.requestId ?? "-"} plan=${trace.planId ?? "-"} run=${trace.runId ?? "-"}`,
  ];
  for (const s of trace.stages) {
    const detail = Object.entries(s.detail)
      .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join(" ");
    lines.push(`  +${s.at - trace.startedAt}ms ${s.stage}  ${detail}`);
  }
  return lines;
}
