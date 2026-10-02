import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearRuns, MAX_RUNS, onRunsChanged, recentRuns, recordRun, totalCost } from "./modelStats";

const run = (costUsd: number, kind: "page" | "links" | "point" = "page") =>
  ({ kind, model: "m", ms: 1000, costUsd, ok: true });

beforeEach(() => clearRuns());

describe("modelStats", () => {
  it("records runs newest first with a timestamp", () => {
    recordRun(run(0.03, "page"));
    recordRun(run(0.004, "links"));
    const [latest, first] = recentRuns();
    expect(latest.kind).toBe("links");
    expect(first.kind).toBe("page");
    expect(typeof latest.at).toBe("number");
  });

  it("limits recentRuns", () => {
    for (let i = 0; i < 30; i++) recordRun(run(0));
    expect(recentRuns(5)).toHaveLength(5);
  });

  it("keeps the session total even past the cap", () => {
    for (let i = 0; i < MAX_RUNS + 10; i++) recordRun(run(0.01));
    expect(recentRuns(MAX_RUNS + 50)).toHaveLength(MAX_RUNS);
    expect(totalCost()).toBeCloseTo((MAX_RUNS + 10) * 0.01);
  });

  it("notifies listeners and resets on clear", () => {
    const cb = vi.fn();
    const off = onRunsChanged(cb);
    recordRun(run(0.02));
    clearRuns();
    expect(cb).toHaveBeenCalledTimes(2);
    expect(totalCost()).toBe(0);
    off();
    recordRun(run(0.02));
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
