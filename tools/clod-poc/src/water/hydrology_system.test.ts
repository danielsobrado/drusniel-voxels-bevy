import { describe, expect, it } from "vitest";
import { hydrologyCoordInsideStartupWorld, hydrologySampleCoord } from "./hydrologySystem.js";

describe("hydrologyCoordInsideStartupWorld", () => {
  it("accepts finite startup-world coordinates", () => {
    expect(hydrologyCoordInsideStartupWorld(0, 0, 1024)).toBe(true);
    expect(hydrologyCoordInsideStartupWorld(1024, 1024, 1024)).toBe(true);
  });

  it("rejects out-of-startup-world coordinates", () => {
    expect(hydrologyCoordInsideStartupWorld(1100, 100, 1024)).toBe(false);
    expect(hydrologyCoordInsideStartupWorld(-20, 100, 1024)).toBe(false);
    expect(hydrologyCoordInsideStartupWorld(100, -20, 1024)).toBe(false);
  });
});

describe("hydrologySampleCoord", () => {
  it("leaves finite-world samples unchanged", () => {
    expect(hydrologySampleCoord(1100, 1024, false)).toBe(1100);
    expect(hydrologySampleCoord(-20, 1024, false)).toBe(-20);
  });

  it("still exposes the old explicit wrap helper for callers that need it", () => {
    expect(hydrologySampleCoord(1100, 1024, true)).toBe(76);
    expect(hydrologySampleCoord(-20, 1024, true)).toBe(1004);
  });
});
