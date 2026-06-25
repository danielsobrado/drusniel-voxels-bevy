import { unzipSync, zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { DEFAULT_DIAGONAL_FLIP_CONFIG, type ClodPagesConfig } from "./config.js";
import {
  createProjectArchive,
  parseProjectArchive,
  PROJECT_SCHEMA_VERSION,
  validateProjectManifest,
  type ClodProjectManifestV1,
  type ProjectSessionState,
} from "./project_archive.js";

const cfg: ClodPagesConfig = {
  page: { chunks_per_page: 2, chunk_size: 16, halo_chunks: 1, quadtree_levels: 2 },
  simplify: {
    target_ratio_per_level: 0.5,
    abandon_ratio: 0.85,
    target_error: 0.01,
    weld_epsilon_cells: 0.001,
    attribute_weights: { normal: 0.5, material: 1 },
  },
  polish: { diagonal_flip: DEFAULT_DIAGONAL_FLIP_CONFIG },
  selection: {
    error_threshold_px: 1,
    hysteresis_merge_factor: 1.5,
    neighbor_level_delta_max: 1,
    transition_mode: "instant",
    crossfade_frames: 12,
  },
  near_field: { radius_chunks: 6 },
  meshopt_package_version: "0.22.0",
  poc: { lod0_pages_x: 8, lod0_pages_z: 8, smoke_lod0_pages_x: 4, smoke_lod0_pages_z: 4, emit_debug_json: true, emit_debug_obj: false },
  validation: { position_epsilon: 0.000001, normal_dot_min: 0.9999, material_weight_epsilon: 0.0001, zero_area_epsilon: 0.00000001 },
};

const state: ProjectSessionState = {
  thresholdPx: 1.25, enforce21: true, freeze: false, wireframe: true,
  showBounds: true, showSeamPoints: false, showCrossLodBorders: true,
  colorByLod: false, normalColor: false, normalDivergence: true, divergenceGain: 9,
  frontSideOnly: true, recomputedNormals: false, forceMaxLevel: "2",
  textureScale: 1.5, triplanar: true, albedo: true, normalMap: true, normalIntensity: 1.5,
  roughness: 0.8, metalness: 0.2,
  textureBlendMode: "blend bands", textureBlendWidth: 5,
  terrainBrightness: 1.1, terrainContrast: 0.9, terrainSaturation: 1.2, terrainWarmth: 0.1,
  sunAzimuthDeg: 120, sunElevationDeg: 40, sunIntensity: 1.2, skyIntensity: 0.8,
  groundIntensity: 0.4, exposure: 1.1, horizonSoftness: 0.8, sunDiskIntensity: 1.4,
  sunGlowIntensity: 1.3, hazeIntensity: 0.2, postProcessEnabled: true,
  postProcessOpacity: 1, postProcessExposure: 1.1, postProcessContrast: 1.05,
  postProcessSaturation: 0.95, postProcessVignette: 0.15, postProcessDebugMode: "output",
  bubble: true, bubbleRadius: 64, tintBubble: false, digEnabled: true, digRadius: 4,
  brushOp: "add", brushShape: "cylinder", brushMaterial: 2, brushHeight: 6,
  brushStrength: 0.75, brushFalloff: 0.25, brushFlowMs: 180, grassEnabled: true,
  grassShaderMode: "terrain-patch-v2", grassAlphaToCoverage: true,
  grassDistance: 96, grassBladeSpacing: 1.6, grassBladeHeight: 1.15,
  grassBladeHeightVariation: 0.75, grassBladeWidth: 0.08, grassWindStrength: 0.32,
  grassWindSpeed: 1.35, grassSlopeMinY: 0.72, grassMinHeight: 20, grassMaxHeight: 86,
  grassMaxBlades: 35000, grassSeed: 1337,
};

function manifest(): ClodProjectManifestV1 {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    kind: "drusniel-clod-project",
    exportedAt: "2026-06-13T10:00:00.000Z",
    worldSize: 4,
    config: cfg,
    state,
    terrainEdits: [{
      x: 4, y: 5, z: 6, r: 3, op: "add", shape: "cube", material: 2,
      height: 6, strength: 0.75, falloff: 0.25,
    }],
    textures: [
      { index: 0, source: "custom", name: "soil.png", selectedId: "custom", scale: 0.02, heightMin: 0, heightMax: 40, customPath: "textures/slot-0.png", mimeType: "image/png" },
      { index: 1, source: "builtin", name: "Rock", selectedId: "cobblestone-1", scale: 0.03, heightMin: 40, heightMax: 70, normalPath: "textures/slot-1-normal.png", normalMimeType: "image/png" },
      { index: 2, source: "empty", name: "empty", selectedId: "", scale: 0.04, heightMin: 70, heightMax: 95 },
      { index: 3, source: "empty", name: "empty", selectedId: "", scale: 0.05, heightMin: 95, heightMax: 120 },
    ],
    camera: { position: [1, 2, 3], target: [4, 5, 6] },
  };
}

function minimalGlb(): Uint8Array {
  const bytes = new Uint8Array(12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  return bytes;
}

describe("CLOD project archive", () => {
  it("round-trips complete session state and exact custom texture bytes", async () => {
    const source = manifest();
    const texture = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
    const normal = new Uint8Array([137, 80, 78, 71, 9, 8, 7, 6]);
    const terrainGlb = minimalGlb();
    const archive = await createProjectArchive(source, terrainGlb, new Map([
      ["textures/slot-0.png", texture],
      ["textures/slot-1-normal.png", normal],
    ]));
    const parsed = await parseProjectArchive(archive);

    expect(parsed.manifest).toEqual(source);
    expect(parsed.terrainGlb).toEqual(terrainGlb);
    expect(parsed.customTextures.get("textures/slot-0.png")).toEqual(texture);
    expect(parsed.customTextures.get("textures/slot-1-normal.png")).toEqual(normal);
    expect(Object.keys(unzipSync(archive))).not.toContain("textures/slot-1.jpg");
  });

  it("rejects unsupported schema versions", () => {
    const invalid = { ...manifest(), schemaVersion: 2 };
    expect(() => validateProjectManifest(invalid)).toThrow(/schema version/i);
  });

  it("defaults legacy grass shader mode to classic", () => {
    const legacy = manifest() as unknown as { state: Partial<ProjectSessionState> };
    delete legacy.state.grassShaderMode;
    expect(validateProjectManifest(legacy).state.grassShaderMode).toBe("classic");
  });

  it("rejects malformed or incomplete archives", async () => {
    await expect(parseProjectArchive(new Uint8Array([1, 2, 3]))).rejects.toThrow(/ZIP archive/i);
    const missingGlb = zipSync({ "project.json": strToU8(JSON.stringify(manifest())) });
    await expect(parseProjectArchive(missingGlb)).rejects.toThrow(/terrain\.glb/i);
    const missingTexture = zipSync({
      "project.json": strToU8(JSON.stringify(manifest())),
      "terrain.glb": minimalGlb(),
    });
    await expect(parseProjectArchive(missingTexture)).rejects.toThrow(/slot-0\.png/i);
  });
});
