import { describe, expect, it } from "vitest";
import customPropsYaml from "../../config/custom_props.yaml?raw";
import { DEFAULT_CUSTOM_PROPS_SETTINGS, parseCustomPropsConfig, propDefById } from "./prop_config.js";
import { validateCustomPropsManifest } from "./prop_asset_validate.js";

describe("parseCustomPropsConfig", () => {
  it("parses the repo custom_props.yaml manifest", () => {
    const settings = parseCustomPropsConfig(customPropsYaml);
    expect(settings.enabled).toBe(false);
    expect(settings.spatial.cellSizeM).toBe(64);
    expect(settings.props).toHaveLength(3);
    const ruin = settings.props.find((p) => p.id === "stone_ruin_wall");
    expect(ruin?.category).toBe("large_static");
    expect(ruin?.lod.billboardFrom).toBe(180);
    expect(ruin?.lightingProxy?.affectGi).toBe(true);
    expect(settings.occlusion).toEqual({
      enabled: true,
      cellSizeM: 4,
      buildOccludersPerFrame: 8,
      footprintPaddingM: 0.35,
      minimumHeightM: 1.5,
      mistClipStrength: 0.85,
    });
  });

  it("falls back to readback-safe defaults for an empty document", () => {
    const settings = parseCustomPropsConfig("");
    expect(settings.enabled).toBe(DEFAULT_CUSTOM_PROPS_SETTINGS.enabled);
    expect(settings.props).toHaveLength(0);
    expect(settings.culling.hysteresisM).toBe(8);
    expect(settings.occlusion).toEqual(DEFAULT_CUSTOM_PROPS_SETTINGS.occlusion);
    expect(settings.gpu).toEqual(DEFAULT_CUSTOM_PROPS_SETTINGS.gpu);
    expect(settings.gpu.debugShowGpuCounts).toBe(false);
  });

  it("keeps bundled custom props GPU count debug disabled unless config opts in", () => {
    const settings = parseCustomPropsConfig(customPropsYaml);
    expect(settings.gpu.debugShowGpuCounts).toBe(false);
  });

  it("parses GPU ring settings", () => {
    const settings = parseCustomPropsConfig(`
gpu:
  enabled: true
  prefer_webgpu: false
  fallback_to_cpu: false
  debug_force_cpu: true
  max_visible: 1234
  workgroup_size: 128
  debug_show_gpu_counts: false
`);

    expect(settings.gpu).toEqual({
      enabled: true,
      preferWebGpu: false,
      fallbackToCpu: false,
      debugForceCpu: true,
      maxVisible: 1234,
      workgroupSize: 128,
      debugShowGpuCounts: false,
    });
  });

  it("sanitizes large-prop occlusion settings", () => {
    const settings = parseCustomPropsConfig(`
large_prop_occlusion:
  enabled: false
  cell_size_m: -2
  build_occluders_per_frame: 0
  footprint_padding_m: -1
  minimum_height_m: -3
  mist_clip_strength: 9
`);

    expect(settings.occlusion).toEqual({
      enabled: false,
      cellSizeM: 0.25,
      buildOccludersPerFrame: 1,
      footprintPaddingM: 0,
      minimumHeightM: 0,
      mistClipStrength: 1,
    });
  });

  it("validates the bundled manifest", () => {
    const settings = parseCustomPropsConfig(customPropsYaml);
    const report = validateCustomPropsManifest(settings);
    expect(report.ok).toBe(true);
    const byId = propDefById(settings);
    expect(byId.get("crate_a")?.culling.maxDistance).toBe(140);
  });
});
