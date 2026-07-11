import { describe, expect, it } from "vitest";
import { DEFAULT_FAR_SUMMARY_CONFIG, resolveFarSummaryBuildBudgets } from "./config.js";

const stream = DEFAULT_FAR_SUMMARY_CONFIG.stream;

describe("resolveFarSummaryBuildBudgets", () => {
  it("boosts budgets while coverage is cold", () => {
    const budgets = resolveFarSummaryBuildBudgets(stream, 0.2, false);
    expect(budgets.warming).toBe(true);
    expect(budgets.maxBuilds).toBe(stream.warmupMaxTileBuildsPerFrame);
    expect(budgets.budgetMs).toBe(stream.warmupMaxBuildMsPerFrame);
  });

  it("drops to steady-state budgets once converged", () => {
    const budgets = resolveFarSummaryBuildBudgets(stream, 0.99, false);
    expect(budgets.warming).toBe(false);
    expect(budgets.maxBuilds).toBeUndefined(); // cache uses its configured per-frame count
    expect(budgets.budgetMs).toBe(stream.maxBuildMsPerFrame);
  });

  it("switches exactly at the configured ready ratio", () => {
    expect(resolveFarSummaryBuildBudgets(stream, stream.warmupReadyRatio - 0.01, false).warming).toBe(true);
    expect(resolveFarSummaryBuildBudgets(stream, stream.warmupReadyRatio, false).warming).toBe(false);
  });

  it("forceSlowBuilds (debug hook) always wins", () => {
    const budgets = resolveFarSummaryBuildBudgets(stream, 0.0, true);
    expect(budgets.warming).toBe(false);
    expect(budgets.maxBuilds).toBe(1);
    expect(budgets.budgetMs).toBe(stream.maxBuildMsPerFrame);
  });

  it("never lowers budgets below the steady-state config during warmup", () => {
    const wide = { ...stream, warmupMaxTileBuildsPerFrame: 1, warmupMaxBuildMsPerFrame: 0.5, maxTileBuildsPerFrame: 3, maxBuildMsPerFrame: 4 };
    const budgets = resolveFarSummaryBuildBudgets(wide, 0.1, false);
    expect(budgets.maxBuilds).toBe(3);
    expect(budgets.budgetMs).toBe(4);
  });
});
