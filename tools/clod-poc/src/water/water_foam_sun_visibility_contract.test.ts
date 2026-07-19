import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FOAM_SOURCE = readFileSync(new URL("./water_foam_nodes.ts", import.meta.url), "utf8");
const MODEL_SOURCE = readFileSync(new URL("./water_foam_model.ts", import.meta.url), "utf8");
const ATLAS_SOURCE = readFileSync(
  new URL("../terrain/sun_visibility/sun_light_gpu_atlas.ts", import.meta.url),
  "utf8",
);
const ATLAS_NODES_SOURCE = readFileSync(
  new URL("../terrain/sun_visibility/sun_light_gpu_atlas_nodes.ts", import.meta.url),
  "utf8",
);

describe("water foam sun visibility contract", () => {
  it("samples the GPU atlas in the shared foam node path without CPU reads", () => {
    expect(FOAM_SOURCE).toContain("buildSunLightGpuAtlasNodes");
    expect(FOAM_SOURCE).not.toContain("sampleSunLightGpuAtlas");
    expect(ATLAS_NODES_SOURCE).toContain("texture(refs.texture, uv).r");
  });

  it("keeps the atlas core renderer-neutral", () => {
    expect(ATLAS_SOURCE).not.toContain('from "three/tsl"');
    expect(ATLAS_SOURCE).toContain("subscribeSunLightGpuAtlas");
    expect(ATLAS_SOURCE.match(/notifyListeners\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(ATLAS_NODES_SOURCE).toContain("subscribeSunLightGpuAtlas(syncSharedState)");
  });

  it("treats missing and out-of-atlas visibility as fully lit", () => {
    expect(ATLAS_NODES_SOURCE).toContain("MISSING_VISIBILITY_CENTER");
    expect(ATLAS_NODES_SOURCE).toContain("float(1), sampled, knownSample");
    expect(ATLAS_NODES_SOURCE).toContain("float(1), resolvedSample, atlasInside");
  });

  it("attenuates coverage without deleting shaded whitewater", () => {
    expect(MODEL_SOURCE).toContain("WATER_FOAM_SHADE_COVERAGE_FLOOR = 0.55");
    expect(FOAM_SOURCE).toContain("source.mul(pattern).mul(wetFade).mul(shadeCoverage)");
  });
});
