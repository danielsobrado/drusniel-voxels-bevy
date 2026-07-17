import { describe, expect, it } from "vitest";
import { waterRuntimeWorldCells } from "./water_startup.js";
import type { HydrologySystem } from "../../water/index.js";

function hydrologyStub(infinite: boolean): HydrologySystem {
  return { supportsInfiniteWorldSamples: () => infinite } as unknown as HydrologySystem;
}

describe("waterRuntimeWorldCells", () => {
  it("keeps normal scenes finite", () => {
    const params = new URLSearchParams("scene=default");

    expect(waterRuntimeWorldCells(params, 1024)).toBe(1024);
  });

  it("uses an effectively unbounded water runtime for infinite islands", () => {
    const params = new URLSearchParams("scene=infinite-islands");

    expect(waterRuntimeWorldCells(params, 1024)).toBeGreaterThan(100_000_000);
  });

  it("uses an unbounded water runtime whenever hydrology answers outside the startup world", () => {
    const params = new URLSearchParams("scene=continent");

    expect(waterRuntimeWorldCells(params, 1024, hydrologyStub(true))).toBeGreaterThan(100_000_000);
  });

  it("stays finite when hydrology is startup-grid only", () => {
    const params = new URLSearchParams("scene=default");

    expect(waterRuntimeWorldCells(params, 1024, hydrologyStub(false))).toBe(1024);
  });
});
