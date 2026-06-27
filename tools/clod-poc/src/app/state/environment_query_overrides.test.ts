import { describe, expect, it } from "vitest";
import { applyEnvironmentQueryOverrides } from "./environment_query_overrides.js";

describe("environment query overrides", () => {
  it("applies finite lighting overrides", () => {
    const state = {
      sunElevationDeg: 45,
      sunAzimuthDeg: 120,
      sunIntensity: 1,
      skyIntensity: 1,
      groundIntensity: 1,
      exposure: 1,
      hazeIntensity: 0.2,
    };
    const params = new URLSearchParams({
      sunElevationDeg: "8",
      sunAzimuthDeg: "-122",
      sunIntensity: "2.5",
      skyIntensity: "0.7",
      groundIntensity: "0.4",
      exposure: "1.2",
      hazeIntensity: "0.9",
    });

    applyEnvironmentQueryOverrides(state as never, params);

    expect(state.sunElevationDeg).toBe(8);
    expect(state.sunAzimuthDeg).toBe(238);
    expect(state.sunIntensity).toBe(2.5);
    expect(state.skyIntensity).toBe(0.7);
    expect(state.groundIntensity).toBe(0.4);
    expect(state.exposure).toBe(1.2);
    expect(state.hazeIntensity).toBe(0.9);
  });

  it("clamps unsafe values and ignores non-finite values", () => {
    const state = {
      sunElevationDeg: 45,
      sunAzimuthDeg: 120,
      sunIntensity: 1,
      skyIntensity: 1,
      groundIntensity: 1,
      exposure: 1,
      hazeIntensity: 0.2,
    };
    const params = new URLSearchParams({
      sunElevationDeg: "200",
      sunAzimuthDeg: "725",
      sunIntensity: "-5",
      exposure: "bad",
    });

    applyEnvironmentQueryOverrides(state as never, params);

    expect(state.sunElevationDeg).toBe(90);
    expect(state.sunAzimuthDeg).toBe(5);
    expect(state.sunIntensity).toBe(0);
    expect(state.exposure).toBe(1);
  });
});
