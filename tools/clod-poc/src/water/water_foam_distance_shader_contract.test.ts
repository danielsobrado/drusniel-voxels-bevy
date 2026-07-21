import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readUtf8 = (url: URL): string => readFileSync(url, "utf8").replace(/\r\n/g, "\n");

const CONFIG_SOURCE = readUtf8(new URL("../../config/water.yaml", import.meta.url));
const FOAM_NODES_SOURCE = readUtf8(new URL("./water_foam_nodes.ts", import.meta.url));
const DISTANCE_SOURCE = readUtf8(new URL("./water_foam_distance.ts", import.meta.url));
const DISTANCE_NODES_SOURCE = readUtf8(new URL("./water_foam_distance_nodes.ts", import.meta.url));
const HQ_SOURCE = readUtf8(new URL("./waterNodeMaterial_base.ts", import.meta.url));
const PERF_SOURCE = readUtf8(new URL("./waterPerfNodeMaterial.ts", import.meta.url));
const WEBGL_SOURCE = readUtf8(new URL("./water_glsl_fragment.ts", import.meta.url));
const UNIFORMS_SOURCE = readUtf8(new URL("./water_uniform_state.ts", import.meta.url));
const MATERIAL_SOURCE = readUtf8(new URL("./waterMaterial.ts", import.meta.url));
const MODEL_SOURCE = readUtf8(new URL("./water_foam_model.ts", import.meta.url));
const DEBUG_SOURCE = readUtf8(
  new URL("../runtime/water_weather/water_controller_debug.ts", import.meta.url),
);

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

  it("injects synthetic metres before the real smoothstep in both shader families", () => {
    expect(DISTANCE_SOURCE).toContain("setWaterFoamDistanceDebugOverrideM");
    expect(DISTANCE_NODES_SOURCE).toContain("mix(measuredDistanceM, refs.debugDistanceM, refs.debugEnabled)");
    expect(DISTANCE_NODES_SOURCE).toContain("smoothstep(startM, endM, distanceM)");
    expect(WEBGL_SOURCE).toContain("uFoamDetailDistanceOverrideEnabled");
    expect(WEBGL_SOURCE).toContain("uFoamDetailDistanceOverrideM");
    expect(WEBGL_SOURCE).toContain("mix(\n      measuredCameraDistanceM,");
    expect(WEBGL_SOURCE).toContain(
      "smoothstep(uFoamDetailFadeStartM, uFoamDetailFadeEndM, cameraDistanceM)",
    );
  });

  it("shares WebGL override uniforms and keeps renderer-neutral state free of TSL", () => {
    expect(UNIFORMS_SOURCE).toContain("getWaterFoamDistanceDebugUniforms");
    expect(UNIFORMS_SOURCE).toContain("uFoamDetailDistanceOverrideEnabled: foamDistanceDebug.enabled");
    expect(UNIFORMS_SOURCE).toContain("uFoamDetailDistanceOverrideM: foamDistanceDebug.distanceM");
    expect(DISTANCE_SOURCE).not.toContain('from "three/tsl"');
    expect(UNIFORMS_SOURCE).not.toContain('from "three/tsl"');
  });

  it("exposes and resets the synthetic acceptance controls only through water debug", () => {
    expect(DEBUG_SOURCE).toContain("setWaterFoamDistanceDebugOverrideM(null)");
    expect(DEBUG_SOURCE).toContain("foamTimeFreeze.setFrozen(false)");
    expect(DEBUG_SOURCE).toContain("setWaterFoamDistanceOverrideM");
    expect(DEBUG_SOURCE).toContain("setWaterFoamTimeFrozen");
    expect(DEBUG_SOURCE).not.toContain('searchParams.get("foamDistance');
  });

  it("publishes and synchronizes the range without a TSL import in WebGL state", () => {
    expect(UNIFORMS_SOURCE).toContain("publishWaterFoamDistanceFade(visual.foam)");
    expect(UNIFORMS_SOURCE).toContain("uFoamDetailFadeStartM");
    expect(MATERIAL_SOURCE).toContain("publishWaterFoamDistanceFade(v.foam)");
    expect(MATERIAL_SOURCE).toContain("uFoamDetailFadeEndM.value = foamDistance.endM");
  });

  it("versions the active runtime contract", () => {
    expect(MODEL_SOURCE).toContain("WATER_FOAM_MODEL_REVISION = 5");
  });
});
