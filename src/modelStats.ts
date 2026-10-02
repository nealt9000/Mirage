// In-memory log of model calls (page, link scan, point resolve) for the dev
// panel: cost and latency per request. Session-only by design.

export type RunKind = "page" | "links" | "point";

export type RunRecord = {
  at: number;
  kind: RunKind;
  model: string;
  ms: number;
  costUsd: number;
  ok: boolean;
};

export const MAX_RUNS = 200;

let runs: RunRecord[] = [];
let total = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) cb();
}

export function recordRun(r: Omit<RunRecord, "at">): void {
  runs.push({ ...r, at: Date.now() });
  if (runs.length > MAX_RUNS) runs = runs.slice(-MAX_RUNS);
  total += r.costUsd;
  notify();
}

export function recentRuns(limit = 20): RunRecord[] {
  return runs.slice(-limit).reverse();
}

export function totalCost(): number {
  return total;
}

export function clearRuns(): void {
  runs = [];
  total = 0;
  notify();
}

export function onRunsChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
