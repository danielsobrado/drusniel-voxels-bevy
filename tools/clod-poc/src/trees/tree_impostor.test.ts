import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { ClodPageNode, PageMesh } from "../types.js";
import type { PageFootprint } from "../types.js";
import {
  cloneTreeSettings,
  DEFAULT_TREE_IMPOSTOR_SETTINGS,
  DEFAULT_TREE_SETTINGS,
  createTreeImpostorBlendMaterial,
  createTreeImpostorMaterial,
  octDecode,
  octEncode,
  octFrameForIndex,
  octFrameIndexForDirection,
  octFrames,
  parseTreeConfig,
  TREE_IMPOSTOR_BLEND_FRAGMENT_SHADER,
  TREE_IMPOSTOR_BLEND_VERTEX_SHADER,
  TREE_IMPOSTOR_FRAGMENT_SHADER,
  TREE_IMPOSTOR_VERTEX_SHADER,
  TREE_SPECIES,
  TreeSystem,
  type TreeImpostorAtlas,
  type TreeSettings,
  type TreeTerrainSampler,
} from "./index.js";

const footprint: PageFootprint = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
const sampler: TreeTerrainSampler = {
  surfaceHeight: () => 24,
  surfaceNormal: () => [0, 1, 0],
  materialWeights: () => [1, 0, 0, 0],
};
const settings: TreeSettings = {
  ...DEFAULT_TREE_SETTINGS,
  seed: 12,
  maxInstances: 100,
  distanceM: 160,
  placement: {
    ...DEFAULT_TREE_SETTINGS.placement,
    spacingM: 4,
    jitter: 0.2,
    slopeMinY: 0,
    minHeightM: 0,
    maxHeightM: 80,
    minGroundWeight: 0.1,
    minSpacingM: 0,
  },
  species: Object.fromEntries(TREE_SPECIES.map((species) => [
    species,
    { ...DEFAULT_TREE_SETTINGS.species[species], minHeightM: 0, maxHeightM: 80 },
  ])) as TreeSettings["species"],
};

function cameraAt(position: THREE.Vector3): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.copy(position);
  return camera;
}

describe("tree impostor config", () => {
  it("uses default impostor settings when the block is missing", () => {
    const parsed = parseTreeConfig("trees:\n  enabled: true\n", null);
    expect(parsed.impostors).toEqual(DEFAULT_TREE_IMPOSTOR_SETTINGS);
  });

  it("clamps impostor settings and rejects source_lod=impostor", () => {
    const parsed = parseTreeConfig(`
trees:
  impostors:
    source_lod: impostor
    resolution_px: 9
    octahedral_grid_size: 99
    atlas_padding_px: 99
    alpha_test: 2
    frame_update_distance_m: 99
    max_bakes_per_frame: 99
    debug_freeze_frame: 99
`, null);

    expect(parsed.impostors.sourceLod).toBe(DEFAULT_TREE_SETTINGS.impostors.sourceLod);
    expect(parsed.impostors.resolutionPx).toBe(32);
    expect(parsed.impostors.octahedralGridSize).toBe(8);
    expect(parsed.impostors.atlasPaddingPx).toBe(8);
    expect(parsed.impostors.alphaTest).toBe(1);
    expect(parsed.impostors.frameUpdateDistanceM).toBe(32);
    expect(parsed.impostors.maxBakesPerFrame).toBe(8);
    expect(parsed.impostors.debugFreezeFrame).toBe(63);
  });

  it("octahedral frame helpers round-trip directions", () => {
    const frames = octFrames(4);
    expect(frames).toHaveLength(16);
    for (const dir of [
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(1, 0.2, 0.4).normalize(),
      new THREE.Vector3(-0.7, 0.5, -0.1).normalize(),
    ]) {
      const enc = octEncode(dir);
      const dec = octDecode(enc.u, enc.v);
      expect(dec.dot(dir)).toBeGreaterThan(0.92);
      const index = octFrameIndexForDirection(dir, 4);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(16);
      expect(octFrameForIndex(index, 4)).toBeDefined();
    }
  });

  it("creates impostor materials", () => {
    const atlas = fakeAtlas();
    const material = createTreeImpostorMaterial(atlas, DEFAULT_TREE_SETTINGS, "oak");
    const blend = createTreeImpostorBlendMaterial(atlas, DEFAULT_TREE_SETTINGS, "oak");
    expect(material.uniforms.treeImpostorMap.value).toBe(atlas.texture);
    expect(blend.uniforms.treeImpostorMap.value).toBe(atlas.texture);
  });
});

function fakeAtlas(): TreeImpostorAtlas {
  return {
    texture: new THREE.Texture(),
    normalDepthTexture: new THREE.Texture(),
    gridSize: 4,
    resolutionPx: 64,
    paddingPx: 1,
    frames: octFrames(4),
    ready: true,
    species: "oak",
    radius: 4,
    centerY: 5,
  };
}
