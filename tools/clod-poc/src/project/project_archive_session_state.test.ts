import { describe, expect, it } from "vitest";
import { validateProjectSessionState } from "./project_archive_session_state.js";

function state(): Record<string, unknown> {
  return {
    thresholdPx: 1.25,
    enforce21: true,
    freeze: false,
    wireframe: false,
    showBounds: false,
    showSeamPoints: false,
    showCrossLodBorders: false,
    colorByLod: false,
    normalColor: false,
    normalDivergence: false,
    divergenceGain: 1,
    frontSideOnly: true,
    recomputedNormals: false,
    forceMaxLevel: "auto",
    textureScale: 1,
    triplanar: true,
    albedo: true,
    normalMap: true,
    normalIntensity: 1,
    roughness: 0.8,
    metalness: 0,
    textureBlendMode: "blend bands",
    textureBlendWidth: 2,
    terrainBrightness: 1,
    terrainContrast: 1,
    terrainSaturation: 1,
    terrainWarmth: 0,
    sunAzimuthDeg: 120,
    sunElevationDeg: 40,
    sunIntensity: 1,
    skyIntensity: 1,
    groundIntensity: 1,
    exposure: 1,
    horizonSoftness: 1,
    sunDiskIntensity: 1,
    sunGlowIntensity: 1,
    hazeIntensity: 0.2,
    postProcessEnabled: true,
    postProcessOpacity: 1,
    postProcessExposure: 1,
    postProcessContrast: 1,
    postProcessSaturation: 1,
    postProcessVignette: 0.1,
    postProcessDebugMode: "output",
    bubble: true,
    bubbleRadius: 64,
    tintBubble: false,
    digEnabled: true,
    digRadius: 4,
    brushOp: "remove",
    brushShape: "sphere",
    brushMaterial: 1,
    brushHeight: 4,
    brushStrength: 1,
    brushFalloff: 0,
    brushFlowMs: 180,
    grassEnabled: true,
    grassShaderMode: "terrain-patch-v2",
    grassAlphaToCoverage: true,
    grassDistance: 96,
    grassBladeSpacing: 1.6,
    grassBladeHeight: 1,
    grassBladeHeightVariation: 0.5,
    grassBladeWidth: 0.08,
    grassWindStrength: 0.3,
    grassWindSpeed: 1.2,
    grassSlopeMinY: 0.7,
    grassMinHeight: 0,
    grassMaxHeight: 100,
    grassMaxBlades: 100_000,
    grassSeed: 1337,
    treesEnabled: true,
    treeDistance: 420,
    treeMaxInstances: 100_000,
    treeDebugColorByLod: false,
    treeWindEnabled: true,
    treeWindStrength: 1,
    treeWindSpeed: 1,
    treeGustStrength: 1,
    treeTrunkSwayStrength: 1,
    treeLeafFlutterStrength: 1,
  };
}

describe("project archive session state", () => {
  it("returns a canonical bounded runtime snapshot", () => {
    const validated = validateProjectSessionState(state());
    expect(validated.grassMaxBlades).toBe(100_000);
    expect(validated.treeMaxInstances).toBe(100_000);
  });

  it("rejects allocation-amplifying vegetation counts", () => {
    const grass = state();
    grass.grassMaxBlades = 500_000_000;
    expect(() => validateProjectSessionState(grass)).toThrow(/grassMaxBlades/i);

    const trees = state();
    trees.treeMaxInstances = 500_000_000;
    expect(() => validateProjectSessionState(trees)).toThrow(/treeMaxInstances/i);
  });

  it("rejects non-finite render and edit values", () => {
    const render = state();
    render.sunIntensity = Number.POSITIVE_INFINITY;
    expect(() => validateProjectSessionState(render)).toThrow(/sunIntensity/i);

    const edit = state();
    edit.digRadius = Number.NaN;
    expect(() => validateProjectSessionState(edit)).toThrow(/digRadius/i);
  });

  it("rejects inverted grass height ranges and invalid enums", () => {
    const heights = state();
    heights.grassMinHeight = 100;
    heights.grassMaxHeight = 10;
    expect(() => validateProjectSessionState(heights)).toThrow(/height range is inverted/i);

    const mode = state();
    mode.forceMaxLevel = "99";
    expect(() => validateProjectSessionState(mode)).toThrow(/forceMaxLevel/i);
  });
});
