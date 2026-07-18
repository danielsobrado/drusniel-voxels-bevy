import { describe, expect, it } from "vitest";
import {
  EnvironmentQueryDiagnostics,
  ENVIRONMENT_QUERY_FIELD,
  type EnvironmentQueryMeta,
} from "./index.js";

const LIVE_META: EnvironmentQueryMeta = {
  source: "live-terrain",
  revision: 7,
  valid: true,
  cellSizeM: 0.5,
};

describe("environment query diagnostics", () => {
  it("records scalar and batch usage without affecting query results", () => {
    const diagnostics = new EnvironmentQueryDiagnostics();
    diagnostics.recordScalar("surface", LIVE_META, 0.1);
    diagnostics.recordBatch(
      ENVIRONMENT_QUERY_FIELD.water | ENVIRONMENT_QUERY_FIELD.river,
      8,
      32,
      0.4,
    );
    diagnostics.recordBatchSource("hydrology-atlas", 8);

    const snapshot = diagnostics.snapshot();
    expect(snapshot.scalarCalls).toBe(1);
    expect(snapshot.batchCalls).toBe(1);
    expect(snapshot.samples).toBe(9);
    expect(snapshot.byField.surface).toBe(1);
    expect(snapshot.byField.water).toBe(8);
    expect(snapshot.byField.river).toBe(8);
    expect(snapshot.bySource["live-terrain"]).toBe(1);
    expect(snapshot.bySource["hydrology-atlas"]).toBe(8);
    expect(snapshot.minHintM).toBe(0.5);
    expect(snapshot.maxHintM).toBe(32);
    expect(snapshot.maxBatchSize).toBe(8);
    expect(snapshot.timeMs).toBeCloseTo(0.5, 6);
  });

  it("tracks invalid and fallback samples", () => {
    const diagnostics = new EnvironmentQueryDiagnostics();
    diagnostics.recordScalar("visibility", {
      source: "fallback",
      revision: 0,
      valid: false,
      cellSizeM: 64,
    });

    const snapshot = diagnostics.snapshot();
    expect(snapshot.invalid).toBe(1);
    expect(snapshot.fallback).toBe(1);
  });

  it("resets all counters", () => {
    const diagnostics = new EnvironmentQueryDiagnostics();
    diagnostics.recordScalar("normal", LIVE_META, 1);
    diagnostics.reset();

    expect(diagnostics.snapshot()).toMatchObject({
      scalarCalls: 0,
      batchCalls: 0,
      samples: 0,
      invalid: 0,
      fallback: 0,
      minHintM: 0,
      maxHintM: 0,
      maxBatchSize: 0,
      timeMs: 0,
    });
  });
});
