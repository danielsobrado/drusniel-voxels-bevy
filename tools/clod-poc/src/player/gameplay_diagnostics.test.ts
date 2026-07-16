import { describe, expect, it } from "vitest";
import { GameplayDiagnostics } from "./gameplay_diagnostics.js";

describe("gameplay diagnostics", () => {
  it("accumulates counts, overwrites gauges, and keeps maxima", () => {
    const diagnostics = new GameplayDiagnostics();
    diagnostics.add("collider_coverage_missing");
    diagnostics.add("collider_coverage_missing");
    diagnostics.add("collider_build_total_ms", 2.5);
    diagnostics.set("collider_queue_latency_ms", 12);
    diagnostics.set("collider_queue_latency_ms", 4);
    diagnostics.setMax("collider_queue_latency_max_ms", 12);
    diagnostics.setMax("collider_queue_latency_max_ms", 4);

    expect(diagnostics.get("collider_coverage_missing")).toBe(2);
    expect(diagnostics.get("collider_build_total_ms")).toBe(2.5);
    expect(diagnostics.get("collider_queue_latency_ms")).toBe(4);
    expect(diagnostics.get("collider_queue_latency_max_ms")).toBe(12);
    expect(diagnostics.get("frontier_barrier_engagements")).toBe(0);
  });

  it("publishes every recorded key into a counters record and resets clean", () => {
    const diagnostics = new GameplayDiagnostics();
    diagnostics.add("edits_denied_not_ready");
    diagnostics.set("time_to_gameplay_ready_ms", 321);

    const counters: Record<string, number> = { untouched: 7 };
    diagnostics.publish(counters);
    expect(counters).toEqual({
      untouched: 7,
      edits_denied_not_ready: 1,
      time_to_gameplay_ready_ms: 321,
    });

    diagnostics.reset();
    expect(diagnostics.snapshot()).toEqual({});
  });
});
