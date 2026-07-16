import { describe, expect, it } from "vitest";
import { summarizeFrameTimes, summarizeNumericEnvelope } from "./route_metrics.js";

describe("long-route metrics", () => {
  it("keeps tail percentiles, maximum, and threshold buckets", () => {
    const values = Array.from({ length: 1_000 }, (_, index) => index / 10);
    const result = summarizeFrameTimes(values);

    expect(result.p50Ms).toBe(49.9);
    expect(result.p95Ms).toBe(94.9);
    expect(result.p99Ms).toBe(98.9);
    expect(result.p999Ms).toBe(99.8);
    expect(result.maxMs).toBe(99.9);
    expect(result.over16_7).toBe(832);
    expect(result.over33_3).toBe(666);
    expect(result.over100).toBe(0);
  });

  it("describes an envelope without treating sawtooth values as a slope", () => {
    expect(summarizeNumericEnvelope([100, 150, 110, 145])).toEqual({
      first: 100,
      last: 145,
      min: 100,
      max: 150,
      highWaterGrowth: 50,
      floorGrowth: 45,
    });
  });
});
