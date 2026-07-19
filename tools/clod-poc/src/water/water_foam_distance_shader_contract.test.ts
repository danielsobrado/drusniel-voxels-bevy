import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CONFIG_SOURCE = readFileSync(new URL("../../config/water.yaml", import.meta.url), "utf8");
const FOAM_NODES_SOURCE = readFileSync(new URL("./water_foam_nodes.ts", import.meta.url), "utf8");
const DISTANCE_NODES_SOURCE = readFileSync(new URL("./water_foam_distance_nodes.ts", import.meta.url), "utf8");
const HQ_SOURCE = readFileSync(new URL("./waterNodeMaterial.ts", import.meta.url), "utf8");
const PERF_SOURCE = readFileSync(new URL("./waterPerfNodeMaterial.ts", import.meta.url), "utf8");
const WEBGL_SOURCE = readFileSync(new URL("./water_glsl_fragment.ts", import.meta.url), "utf8");
const UNIFORMS_SOURCE = readFileSync(new URL("./water_uniform_state.ts", import.meta.url), "utf8");
const MATERIAL_SOURCE = readFileSync(new URL("./waterMaterial.ts", import.meta.url), "utf8");
const MODEL_SOURCE = readFileSync(new URL("./water_foam_model.ts", import.meta.url), "utf8");

describe("shared water foam camera-distance fade", () => {
  it("owns the metre range in canonical YAML", () => {
    expect(CONFIG_SOURCE).toContain("detail_fade_start_m: 120.0");
    expect(CONFIG_SOURCE).toContain("detail_fade_end_m: 320.0");
  });

  it("applies one shared TSL distance node to the canonical coverage", () => {
    expect(FOAM_NODES_SOURCE).toContain("buildWaterFoamDistanceFadeNode");
    expect(FOAM_NODES_SOURCE).toContain("shadeCoverage).mul(detailFade)");
    expect(DISTANCE_NODES_SOURCE).toContain("cameraPosition.xz");
    expect(DISTANCE_NODES_SOURCE).toContain("subscribeWaterFoamDistanceFade");
    expect(DISTANCE_NODES_SOURCE).toContain("mix(float(1), resolved, valid)");
  });

  it("lets HQ consume the shared authority without a material-specific fade", () => {
    expect(HQ_SOURCE).toContain("makeWaterUniforms(params)");
    expect(HQ_SOURCE).toContain("buildWaterFoamNodes({");
    expect(HQ_SOURCE).not.toContain("FAR_FOAM_DETAIL_START_LEVEL");
    expect(HQ_SOURCE).not.toContain("farDetailFade");
  });

  it("removes performance clipmap-level fading and supplies the same metre range", () => {
    expect(PERF_SOURCE).toContain("cameraXZ: uCameraPos.xz");
    expect(PERF_SOURCE).toContain("detailFadeStartM: uFoamDetailFadeStartM");
    expect(PERF_SOURCE).toContain("detailFadeEndM: uFoamDetailFadeEndM");
    expect(PERF_SOURCE).toContain("const foam: TslNode = foamNodes.coverage");
    expect(PERF_SOURCE).not.toContain("FAR_FOAM_DETAIL_START_LEVEL");
    expect(PERF_SOURCE).not.toContain("farDetailFade");
    expect(PERF_SOURCE).not.toContain("smoothstep(0.25, 1.25, aLevel)");
  });

  it("uses the same camera-distance policy in WebGL", () => {
    expect(WEBGL_SOURCE).toContain("uniform float uFoamDetailFadeStartM");
    expect(WEBGL_SOURCE).toContain("uniform float uFoamDetailFadeEndM");
    expect(WEBGL_SOURCE).toContain("distance(worldPos.xz, uCameraPos.xz)");
    expect(WEBGL_SOURCE).toContain("wetFade * foamDetailFade");
    expect(WEBGL_SOURCE).not.toContain("smoothstep(0.25, 1.25, vLevel)");
  });

  it("publishes and synchronizes the range without a TSL import in WebGL state", () => {
    expect(UNIFORMS_SOURCE).toContain("publishWaterFoamDistanceFade(visual.foam)");
    expect(UNIFORMS_SOURCE).toContain("uFoamDetailFadeStartM");
    expect(UNIFORMS_SOURCE).not.toContain('from "three/tsl"');
    expect(MATERIAL_SOURCE).toContain("publishWaterFoamDistanceFade(v.foam)");
    expect(MATERIAL_SOURCE).toContain("uFoamDetailFadeEndM.value = foamDistance.endM");
  });

  it("versions the active runtime contract", () => {
    expect(MODEL_SOURCE).toContain("WATER_FOAM_MODEL_REVISION = 4");
  });
});
