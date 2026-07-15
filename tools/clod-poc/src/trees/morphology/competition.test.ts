import { describe, expect, it } from "vitest";
import { sampleTreeCompetition } from "./competition.js";
import { impostorAgeLayerBlend, impostorLayerIndex } from "./impostor_layers.js";

describe("tree competition and impostor morphology", () => {
  it("samples deterministic competition independently of streaming state", () => {
    const first = sampleTreeCompetition({ worldSeed: 7331, positionXZ: [120.5, -43.25], species: "oak" });
    const second = sampleTreeCompetition({ worldSeed: 7331, positionXZ: [120.5, -43.25], species: "oak" });
    expect(second).toEqual(first);
    expect(first.crownPressure).toBeGreaterThanOrEqual(0);
    expect(first.crownPressure).toBeLessThanOrEqual(1);
    expect(Math.hypot(...first.openLightDirectionXZ)).toBeCloseTo(1, 6);
  });

  it("continuously blends the nearest age layers", () => {
    expect(impostorAgeLayerBlend(0.2)).toEqual({ lowerBucket: 0, upperBucket: 0, blend: 0 });
    expect(impostorAgeLayerBlend(0.4)).toEqual({ lowerBucket: 0, upperBucket: 1, blend: expect.closeTo(0.5) });
    expect(impostorAgeLayerBlend(0.76)).toEqual({ lowerBucket: 1, upperBucket: 2, blend: expect.closeTo(0.5) });
    expect(impostorLayerIndex(3, 2)).toBe(11);
  });
});
