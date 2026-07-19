import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ATLAS_NODES_SOURCE = readFileSync(
  new URL("../terrain/sun_visibility/sun_light_gpu_atlas_nodes.ts", import.meta.url),
  "utf8",
);
const WATER_DEBUG_SOURCE = readFileSync(
  new URL("../runtime/water_weather/water_controller_debug.ts", import.meta.url),
  "utf8",
);

describe("water foam shade acceptance override", () => {
  it("mixes the debug override after real atlas resolution", () => {
    expect(ATLAS_NODES_SOURCE).toContain("const atlasVisibility");
    expect(ATLAS_NODES_SOURCE).toContain("refs.debugOverrideVisibility");
    expect(ATLAS_NODES_SOURCE).toContain("refs.debugOverrideEnabled");
    expect(ATLAS_NODES_SOURCE).not.toContain("state.texture.image =");
  });

  it("fails closed for invalid override values and clamps valid values", () => {
    expect(ATLAS_NODES_SOURCE).toContain("must be finite or null");
    expect(ATLAS_NODES_SOURCE).toContain("Math.min(1, Math.max(0, value))");
  });

  it("loads the TSL override only through the existing debug API", () => {
    expect(WATER_DEBUG_SOURCE).toContain("setWaterFoamSunVisibilityOverride");
    expect(WATER_DEBUG_SOURCE).toContain("await import(");
    expect(WATER_DEBUG_SOURCE).toContain("setSunLightGpuAtlasDebugOverride(visibility)");
    expect(WATER_DEBUG_SOURCE).not.toContain(
      'import { setSunLightGpuAtlasDebugOverride } from',
    );
    expect(WATER_DEBUG_SOURCE).not.toContain('searchParams.get("foamSun")');
  });
});
