import { describe, expect, it } from "vitest";
import { NaadfMetricsCollector } from "../metrics.js";
import { runAcceptanceChecks } from "../validation.js";
import { createTestNaadfConfig } from "./testConfig.js";

describe("naadf validation", () => {
  it("fails compare mode when HDDA has parity mismatches", () => {
    const base = createTestNaadfConfig();
    const config = {
      ...base,
      traversal: {
        ...base.traversal,
        mode: "compare" as const,
      },
    };
    const metrics = new NaadfMetricsCollector();
    metrics.frame = 120;
    metrics.hddaDenseMismatches = 1;

    const checks = runAcceptanceChecks(config, metrics.snapshot(), 120);
    const parity = checks.find((c) => c.name === "hdda_dense_mismatches");

    expect(parity?.passed).toBe(false);
  });

  it("keeps dense mode independent from HDDA mismatch counters", () => {
    const config = createTestNaadfConfig();
    const metrics = new NaadfMetricsCollector();
    metrics.frame = 120;
    metrics.hddaDenseMismatches = 1;

    const checks = runAcceptanceChecks(config, metrics.snapshot(), 120);
    const parity = checks.find((c) => c.name === "hdda_dense_mismatches");

    expect(parity?.passed).toBe(true);
  });
});
