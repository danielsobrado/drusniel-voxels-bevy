import { describe, expect, it } from "vitest";
import { waterRuntimeWorldCells } from "./water_startup.js";

describe("waterRuntimeWorldCells", () => {
  it("keeps normal scenes finite", () => {
    const params = new URLSearchParams("scene=default");

    expect(waterRuntimeWorldCells(params, 1024)).toBe(1024);
  });

  it("uses an effectively unbounded water runtime for infinite islands", () => {
    const params = new URLSearchParams("scene=infinite-islands");

    expect(waterRuntimeWorldCells(params, 1024)).toBeGreaterThan(100_000_000);
  });
});
