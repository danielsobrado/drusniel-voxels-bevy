import { describe, expect, it } from "vitest";
import phase1ConfigText from "../../config/phase1_terrain.yaml?raw";
import { parsePhase1Config } from "./phase1_config.js";
import { generatePhase1Heightfield } from "./terrain_synthesis.js";

describe("generatePhase1Heightfield", () => {
  const config = parsePhase1Config(phase1ConfigText);

  it("is deterministic for the same seed and config", () => {
    const a = generatePhase1Heightfield(7, config, 64);
    const b = generatePhase1Heightfield(7, config, 64);
    expect(a.signature).toBe(b.signature);
    expect(a.minHeight).toBeCloseTo(b.minHeight);
    expect(a.maxHeight).toBeCloseTo(b.maxHeight);
  });

  it("changes signature for a different seed", () => {
    const a = generatePhase1Heightfield(7, config, 64);
    const b = generatePhase1Heightfield(8, config, 64);
    expect(a.signature).not.toBe(b.signature);
  });

  it("generates finite height, slope, flow, and valid biome ids", () => {
    const field = generatePhase1Heightfield(1, config, 96);
    for (const value of field.heights) expect(Number.isFinite(value)).toBe(true);
    for (const value of field.slope) expect(Number.isFinite(value)).toBe(true);
    for (const value of field.flow) expect(Number.isFinite(value)).toBe(true);
    for (const value of field.biome) expect(value).toBeGreaterThanOrEqual(0);
    for (const value of field.biome) expect(value).toBeLessThanOrEqual(3);
  });
});
