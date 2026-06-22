import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { ClodPageNode, PageMesh } from "../types.js";
import type { PageFootprint } from "../types.js";
import {
  cloneTreeSettings,
  DEFAULT_TREE_ECOLOGY_SETTINGS,
  DEFAULT_TREE_FOLIAGE_SETTINGS,
  DEFAULT_TREE_SETTINGS,
  DEFAULT_TREE_WIND_SETTINGS,
  createTreeFoliageAtlas,
  createTreeGeometryMap,
  createTreeMaterialHandle,
  createTreeRingNodeMaterialHandle,
  disposeTreeGeometryMap,
  formatTreeInfoLine,
  formatTreeTotalDisplay,
  generateTreeInstances,
  generateTreeRingLightingProxies,
  injectTreeFoliageFragmentShader,
  injectTreeFoliageVertexShader,
  injectTreeWindShader,
  parseTreeConfig,
  packTreeGpuFrustumPlanes,
  selectTreeSpecies,
  treeGeometryKey,
  treeGeometrySummary,
  treeUsesGpuRingDraw,
  TreeSystem,
  TREE_LODS,
  TREE_GPU_RING_LIGHTING_PROXY_CAP,
  TREE_SPECIES,
  type TreeLod,
  type TreeSettings,
  type TreeTerrainSampler,
} from "./index.js";
import type { TreeGpuRingStats } from "../gpu/tree_ring_compute.js";
import treeYamlText from "../../config/trees.yaml?raw";

const footprint: PageFootprint = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
const sampler: TreeTerrainSampler = {
  surfaceHeight: () => 24,
  surfaceNormal: () => [0, 1, 0],
  materialWeights: () => [1, 0, 0, 0],
};
const settings: TreeSettings = {
  ...DEFAULT_TREE_SETTINGS,
  seed: 10,
  maxInstances: 1000,
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
  species: {
    oak: { ...DEFAULT_TREE_SETTINGS.species.oak, minHeightM: 0, maxHeightM: 80 },
    pine: { ...DEFAULT_TREE_SETTINGS.species.pine, minHeightM: 0, maxHeightM: 80 },
    dead: { ...DEFAULT_TREE_SETTINGS.species.dead, minHeightM: 0, maxHeightM: 80 },
  },
};

function pageMesh(): PageMesh {
  return {
    positions: new Float32Array([0, 24, 0, 32, 24, 0, 0, 24, 32]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    materials: new Float32Array([0, 0, 0]),
    indices: new Uint32Array([0, 1, 2]),
  };
}

function pageNode(mesh: PageMesh = pageMesh(), nodeFootprint: PageFootprint = footprint): ClodPageNode {
  return {
    id: "L0:0,0",
    level: 0,
    children: [],
    mesh,
    footprint: nodeFootprint,
    bounds: {
      center: [(nodeFootprint.minX + nodeFootprint.maxX) * 0.5, 24, (nodeFootprint.minZ + nodeFootprint.maxZ) * 0.5],
      radius: Math.hypot(nodeFootprint.maxX - nodeFootprint.minX, nodeFootprint.maxZ - nodeFootprint.minZ) * 0.5,
    },
    errorWorld: 0,
    lowBenefit: false,
  };
}

function meshSnapshot(mesh: PageMesh) {
  return {
    positions: [...mesh.positions],
    normals: [...mesh.normals],
    materials: [...mesh.materials],
    indices: [...mesh.indices],
  };
}

function instancedTreeMeshes(scene: THREE.Scene): THREE.InstancedMesh[] {
  const meshes: THREE.InstancedMesh[] = [];
  scene.traverse((object) => {
    if ((object as THREE.InstancedMesh).isInstancedMesh) meshes.push(object as THREE.InstancedMesh);
  });
  return meshes;
}

function fakeGpuDevice(): GPUDevice {
  return {
    limits: {
      maxStorageBuffersPerShaderStage: 99,
    },
  } as unknown as GPUDevice;
}

function fakeRingStats() {
  return {
    status: "ready" as const,
    candidateCount: 8,
    acceptedCandidates: 3,
    counts: { near: 1, mid: 1, far: 1, impostor: 0 },
    groupCounts: [],
    overflowed: false,
    dispatchMs: 0.25,
    readbackMs: null,
    skippedDispatches: 0,
  };
}

function treeLodForPosition(position: readonly [number, number, number], center: THREE.Vector3, treeSettings: TreeSettings): string {
  const distance = Math.hypot(center.x - position[0], center.z - position[2]);
  if (distance <= treeSettings.distanceM * treeSettings.lod.nearFraction) return "near";
  if (distance <= treeSettings.distanceM * treeSettings.lod.midFraction) return "mid";
  return "far";
}

function pointPassesPlanes(planes: ArrayLike<number>, point: THREE.Vector3): boolean {
  for (let i = 0; i < 6; i++) {
    const offset = i * 4;
    if (
      planes[offset] * point.x +
      planes[offset + 1] * point.y +
      planes[offset + 2] * point.z +
      planes[offset + 3] < 0
    ) {
      return false;
    }
  }
  return true;
}

describe("tree placement", () => {
  it("keeps default tree wind settings independent from the shared wind defaults", () => {
    expect(DEFAULT_TREE_SETTINGS.wind).not.toBe(DEFAULT_TREE_WIND_SETTINGS);
    expect(DEFAULT_TREE_SETTINGS.wind.direction).not.toBe(DEFAULT_TREE_WIND_SETTINGS.direction);
    expect(DEFAULT_TREE_SETTINGS.wind).toEqual(DEFAULT_TREE_WIND_SETTINGS);
  });

  it("deep-clones tree wind direction", () => {
    const cloned = cloneTreeSettings();
    expect(cloned.wind).not.toBe(DEFAULT_TREE_SETTINGS.wind);
    expect(cloned.wind.direction).not.toBe(DEFAULT_TREE_SETTINGS.wind.direction);
    cloned.wind.direction[0] = -1;
    expect(DEFAULT_TREE_SETTINGS.wind.direction[0]).toBe(DEFAULT_TREE_WIND_SETTINGS.direction[0]);
  });

  it("deep-clones tree ecology settings", () => {
    const cloned = cloneTreeSettings();
    expect(cloned.ecology).not.toBe(DEFAULT_TREE_SETTINGS.ecology);
    expect(cloned.ecology.density).not.toBe(DEFAULT_TREE_SETTINGS.ecology.density);
    expect(cloned.ecology.speciesZones.oak).not.toBe(DEFAULT_TREE_SETTINGS.ecology.speciesZones.oak);
    cloned.ecology.density.baseDensity = 0.25;
    cloned.ecology.speciesZones.oak.moisturePreference = 0.1;
    expect(DEFAULT_TREE_SETTINGS.ecology.density.baseDensity).toBe(DEFAULT_TREE_ECOLOGY_SETTINGS.density.baseDensity);
    expect(DEFAULT_TREE_SETTINGS.ecology.speciesZones.oak.moisturePreference)
      .toBe(DEFAULT_TREE_ECOLOGY_SETTINGS.speciesZones.oak.moisturePreference);
  });

  it("deep-clones tree foliage settings", () => {
    const cloned = cloneTreeSettings();
    expect(cloned.foliage).not.toBe(DEFAULT_TREE_SETTINGS.foliage);
    expect(cloned.foliage.oak).not.toBe(DEFAULT_TREE_SETTINGS.foliage.oak);
    expect(cloned.foliage.pine).not.toBe(DEFAULT_TREE_SETTINGS.foliage.pine);
    cloned.foliage.oak.cardCountNear = 1;
    cloned.foliage.pine.edgeNoise = 0;
    expect(DEFAULT_TREE_SETTINGS.foliage.oak.cardCountNear).toBe(DEFAULT_TREE_FOLIAGE_SETTINGS.oak.cardCountNear);
    expect(DEFAULT_TREE_SETTINGS.foliage.pine.edgeNoise).toBe(DEFAULT_TREE_FOLIAGE_SETTINGS.pine.edgeNoise);
  });

  it("deep-clones tree LOD budget settings", () => {
    const cloned = cloneTreeSettings();
    expect(cloned.lod).not.toBe(DEFAULT_TREE_SETTINGS.lod);
    expect(cloned.lod.budgets).not.toBe(DEFAULT_TREE_SETTINGS.lod.budgets);
    cloned.lod.budgets.impostorMaxVertices = 1;
    expect(DEFAULT_TREE_SETTINGS.lod.budgets.impostorMaxVertices).toBe(240);
  });

  it("deep-clones tree GPU settings", () => {
    const cloned = cloneTreeSettings();
    expect(cloned.gpu).not.toBe(DEFAULT_TREE_SETTINGS.gpu);
    cloned.gpu.enabled = true;
    cloned.gpu.maxVisible = 1;
    expect(DEFAULT_TREE_SETTINGS.gpu.enabled).toBe(false);
    expect(DEFAULT_TREE_SETTINGS.gpu.maxVisible).toBe(50_000);
  });

  it("parses config/trees.yaml to the typed defaults", () => {
    expect(parseTreeConfig(treeYamlText, null)).toEqual(DEFAULT_TREE_SETTINGS);
  });

  it("uses default morphology when species morphology is missing", () => {
    const parsed = parseTreeConfig(`
trees:
  species:
    oak:
      enabled: true
      weight: 0.7
`, null);

    expect(parsed.species.oak.morphology).toEqual(DEFAULT_TREE_SETTINGS.species.oak.morphology);
    expect(parsed.species.pine.morphology).toEqual(DEFAULT_TREE_SETTINGS.species.pine.morphology);
  });

  it("uses default ecology when the ecology block is missing", () => {
    const parsed = parseTreeConfig(`
trees:
  enabled: true
`, null);

    expect(parsed.ecology).toEqual(DEFAULT_TREE_SETTINGS.ecology);
  });

  it("uses default foliage when the foliage block is missing", () => {
    const parsed = parseTreeConfig(`
trees:
  enabled: true
`, null);

    expect(parsed.foliage).toEqual(DEFAULT_TREE_SETTINGS.foliage);
  });

  it("uses default GPU tree settings when the gpu block is missing", () => {
    const parsed = parseTreeConfig(`
trees:
  enabled: true
`, null);

    expect(parsed.gpu).toEqual(DEFAULT_TREE_SETTINGS.gpu);
  });

  it("clamps invalid GPU tree settings to safe ranges", () => {
    const parsed = parseTreeConfig(`
trees:
  gpu:
    enabled: true
    max_visible: 9999999
`, null);

    expect(parsed.gpu).toMatchObject({
      enabled: true,
      maxVisible: 500_000,
    });
  });

  it("exposes the ring material nodes used by the depth prepass", () => {
    const buffers = {
      cell: new THREE.BufferAttribute(new Float32Array(4), 4),
      capacity: 1,
    };
    const handle = createTreeRingNodeMaterialHandle(DEFAULT_TREE_SETTINGS, buffers, "near");
    try {
      const materialNodes = handle.regularMaterial as unknown as { positionNode: unknown; maskNode: unknown };
      const prepassNodes = handle.prepassNodesFor?.("near");
      expect(prepassNodes?.positionNode).toBe(materialNodes.positionNode);
      expect(prepassNodes?.maskNode).toBe(materialNodes.maskNode);
      expect(prepassNodes?.side).toBe(THREE.DoubleSide);
    } finally {
      handle.dispose();
    }
  });

  it("clamps invalid foliage values to safe ranges", () => {
    const parsed = parseTreeConfig(`
trees:
  foliage:
    alpha_test: -1
    mask_resolution_px: 999
    texture_atlas_columns: 0
    texture_atlas_rows: 99
    oak:
      card_count_near: 999
      card_count_mid: -1
      card_count_far: 99
      card_width_m: -1
      card_height_m: 99
      card_size_variation: 3
      cluster_spread_m: -2
      crown_flattening: -4
      tint_variation: 2
      edge_noise: -2
      lobe_count: 99
      cutout_roundness: 4
`, null);

    expect(parsed.foliage.alphaTest).toBe(0);
    expect(parsed.foliage.maskResolutionPx).toBe(256);
    expect(parsed.foliage.textureAtlasColumns).toBe(1);
    expect(parsed.foliage.textureAtlasRows).toBe(8);
    expect(parsed.foliage.oak).toMatchObject({
      cardCountNear: 256,
      cardCountMid: 0,
      cardCountFar: 16,
      cardWidthM: 0.05,
      cardHeightM: 8,
      cardSizeVariation: 1,
      clusterSpreadM: 0,
      crownFlattening: 0.25,
      tintVariation: 1,
      edgeNoise: 0,
      lobeCount: 16,
      cutoutRoundness: 1,
    });
  });

  it("clamps invalid ecology values to safe ranges", () => {
    const parsed = parseTreeConfig(`
trees:
  ecology:
    enabled: true
    density:
      base_density: -1
      forest_noise_scale_m: -2
      forest_noise_strength: 9
      clearing_noise_scale_m: 99999
      clearing_threshold: -4
      clearing_softness: 0
      edge_softness_m: -8
    terrain:
      lowland_height_m: -999
      highland_height_m: 99999
      height_fade_m: -1
      slope_fade_start_y: -1
      slope_fade_end_y: 2
      material_weight_power: -1
    clustering:
      cluster_scale_m: -1
      cluster_strength: 4
      cluster_threshold: -2
      min_spacing_jitter: 3
    age:
      young_probability: -1
      old_probability: 5
      scale_young: -1
      scale_mature: 9
      scale_old: 9
      scale_variation: 9
    species_zones:
      oak:
        height_preference: sideways
        moisture_preference: -3
        slope_tolerance: 5
        cluster_bias: 9
        old_forest_bias: 9
`, null);

    expect(parsed.ecology.density).toMatchObject({
      baseDensity: 0,
      forestNoiseScaleM: 4,
      forestNoiseStrength: 1,
      clearingNoiseScaleM: 2048,
      clearingThreshold: 0,
      clearingSoftness: 0.001,
      edgeSoftnessM: 0,
    });
    expect(parsed.ecology.terrain).toMatchObject({
      lowlandHeightM: -256,
      highlandHeightM: 4096,
      heightFadeM: 0.001,
      slopeFadeStartY: 0,
      slopeFadeEndY: 1,
      materialWeightPower: 0.1,
    });
    expect(parsed.ecology.clustering).toMatchObject({
      clusterScaleM: 4,
      clusterStrength: 1,
      clusterThreshold: 0,
      minSpacingJitter: 1,
    });
    expect(parsed.ecology.age).toMatchObject({
      youngProbability: 0,
      oldProbability: 1,
      scaleYoung: 0.1,
      scaleMature: 3,
      scaleOld: 4,
      scaleVariation: 1,
    });
    expect(parsed.ecology.speciesZones.oak).toMatchObject({
      heightPreference: DEFAULT_TREE_SETTINGS.ecology.speciesZones.oak.heightPreference,
      moisturePreference: 0,
      slopeTolerance: 1,
      clusterBias: 2,
      oldForestBias: 2,
    });
  });

  it("clamps negative morphology values to sane minimums", () => {
    const parsed = parseTreeConfig(`
trees:
  species:
    oak:
      morphology:
        trunk_bend: -1
        trunk_taper: -1
        branch_levels: -3
        primary_branch_count: -7
        secondary_branch_count: -2
        branch_spread: -1
        branch_up_sweep: -3
        branch_length: -5
        crown_flattening: -2
        crown_irregularity: -1
        leaf_cluster_count: -4
        leaf_card_count: -8
`, null);

    expect(parsed.species.oak.morphology).toMatchObject({
      trunkBend: 0,
      trunkTaper: 0,
      branchLevels: 0,
      primaryBranchCount: 0,
      secondaryBranchCount: 0,
      branchSpread: 0,
      branchUpSweep: -1,
      branchLength: 0,
      crownFlattening: 0.25,
      crownIrregularity: 0,
      leafClusterCount: 0,
      leafCardCount: 0,
    });
  });

  it("clamps large morphology values to safe maximums", () => {
    const parsed = parseTreeConfig(`
trees:
  species:
    oak:
      morphology:
        trunk_bend: 10
        trunk_taper: 10
        branch_levels: 99
        primary_branch_count: 99
        secondary_branch_count: 99
        branch_spread: 10
        branch_up_sweep: 10
        branch_length: 99
        crown_flattening: 10
        crown_irregularity: 10
        leaf_cluster_count: 999
        leaf_card_count: 999
`, null);

    expect(parsed.species.oak.morphology).toMatchObject({
      trunkBend: 1.5,
      trunkTaper: 0.95,
      branchLevels: 4,
      primaryBranchCount: 24,
      secondaryBranchCount: 8,
      branchSpread: 2,
      branchUpSweep: 1.5,
      branchLength: 8,
      crownFlattening: 3,
      crownIrregularity: 1,
      leafClusterCount: 96,
      leafCardCount: 192,
    });
  });

  it("clamps invalid tree LOD fractions to fractions", () => {
    const parsed = parseTreeConfig(`
trees:
  enabled: true
  lod:
    near_fraction: -0.5
    mid_fraction: 1.5
    far_fraction: 2
`, null);

    expect(parsed.lod).toMatchObject({
      nearFraction: 0,
      midFraction: 1,
      farFraction: 1,
      impostorFraction: 1,
    });
  });

  it("orders invalid tree LOD fractions deterministically", () => {
    const parsed = parseTreeConfig(`
trees:
  enabled: true
  lod:
    near_fraction: 0.8
    mid_fraction: 0.2
    far_fraction: 0.4
`, null);

    expect(parsed.lod.nearFraction).toBeCloseTo(0.8);
    expect(parsed.lod.midFraction).toBeCloseTo(0.8);
    expect(parsed.lod.farFraction).toBeCloseTo(0.8);
    expect(parsed.lod.impostorFraction).toBeCloseTo(1.0);
  });

  it("keeps enabled tree impostor LOD distance non-zero", () => {
    const parsed = parseTreeConfig(`
trees:
  enabled: true
  lod:
    near_fraction: 0
    mid_fraction: 0
    far_fraction: 0
`, null);

    expect(parsed.lod.nearFraction).toBe(0);
    expect(parsed.lod.midFraction).toBeGreaterThanOrEqual(parsed.lod.nearFraction);
    expect(parsed.lod.impostorFraction).toBeGreaterThanOrEqual(0.01);
    expect(parsed.lod.farFraction).toBeGreaterThanOrEqual(parsed.lod.midFraction);
    expect(parsed.lod.impostorFraction).toBeGreaterThanOrEqual(parsed.lod.farFraction);
  });

  it("uses defaults for missing impostor LOD settings", () => {
    const parsed = parseTreeConfig(`
trees:
  lod:
    near_fraction: 0.2
    mid_fraction: 0.4
    far_fraction: 0.6
`, null);

    expect(parsed.lod.impostorFraction).toBe(DEFAULT_TREE_SETTINGS.lod.impostorFraction);
    expect(parsed.lod.hysteresisM).toBe(DEFAULT_TREE_SETTINGS.lod.hysteresisM);
    expect(parsed.lod.crossfadeEnabled).toBe(DEFAULT_TREE_SETTINGS.lod.crossfadeEnabled);
    expect(parsed.lod.crossfadeBandM).toBe(DEFAULT_TREE_SETTINGS.lod.crossfadeBandM);
    expect(parsed.lod.ditherEnabled).toBe(DEFAULT_TREE_SETTINGS.lod.ditherEnabled);
    expect(parsed.lod.shadowsMaxLod).toBe(DEFAULT_TREE_SETTINGS.lod.shadowsMaxLod);
    expect(parsed.lod.budgets).toEqual(DEFAULT_TREE_SETTINGS.lod.budgets);
  });

  it("clamps LOD transition settings, shadows, and budgets", () => {
    const parsed = parseTreeConfig(`
trees:
  lod:
    hysteresis_m: -5
    crossfade_enabled: false
    crossfade_band_m: -2
    dither_enabled: false
    shadows_max_lod: sideways
    budgets:
      near_max_vertices: -10
      mid_max_vertices: 0
      far_max_vertices: -1
      impostor_max_vertices: 0
`, null);

    expect(parsed.lod.hysteresisM).toBe(0);
    expect(parsed.lod.crossfadeEnabled).toBe(false);
    expect(parsed.lod.crossfadeBandM).toBe(0);
    expect(parsed.lod.ditherEnabled).toBe(false);
    expect(parsed.lod.shadowsMaxLod).toBe(DEFAULT_TREE_SETTINGS.lod.shadowsMaxLod);
    expect(parsed.lod.budgets).toEqual({
      nearMaxVertices: 1,
      midMaxVertices: 1,
      farMaxVertices: 1,
      impostorMaxVertices: 1,
    });
  });

  it("parses and normalizes tree wind settings", () => {
    const parsed = parseTreeConfig(`
trees:
  wind:
    enabled: false
    direction: [3, 4]
    strength: 0.5
    speed: 2
    gust_strength: 0.25
    trunk_sway_strength: 0.6
    leaf_flutter_strength: 0.35
`, null);

    expect(parsed.wind.enabled).toBe(false);
    expect(parsed.wind.direction[0]).toBeCloseTo(0.6);
    expect(parsed.wind.direction[1]).toBeCloseTo(0.8);
    expect(parsed.wind.strength).toBe(0.5);
    expect(parsed.wind.speed).toBe(2);
    expect(parsed.wind.gustStrength).toBe(0.25);
    expect(parsed.wind.trunkSwayStrength).toBe(0.6);
    expect(parsed.wind.leafFlutterStrength).toBe(0.35);
  });

  it("falls back for invalid wind direction and clamps negative wind values", () => {
    const parsed = parseTreeConfig(`
trees:
  wind:
    direction: [0, 0]
    strength: -1
    speed: -2
    gust_strength: -3
    trunk_sway_strength: -4
    leaf_flutter_strength: -5
`, null);

    expect(parsed.wind.direction).toEqual(DEFAULT_TREE_SETTINGS.wind.direction);
    expect(parsed.wind.strength).toBe(0);
    expect(parsed.wind.speed).toBe(0);
    expect(parsed.wind.gustStrength).toBe(0);
    expect(parsed.wind.trunkSwayStrength).toBe(0);
    expect(parsed.wind.leafFlutterStrength).toBe(0);
  });

  it("is deterministic for the same footprint, seed, and config", () => {
    expect(generateTreeInstances(footprint, settings, settings.maxInstances, undefined, sampler, 32))
      .toEqual(generateTreeInstances(footprint, settings, settings.maxInstances, undefined, sampler, 32));
  });

  it("changes placement when the seed changes", () => {
    const first = generateTreeInstances(footprint, settings, settings.maxInstances, undefined, sampler, 32);
    const second = generateTreeInstances(footprint, { ...settings, seed: settings.seed + 1 }, settings.maxInstances, undefined, sampler, 32);
    expect(second).not.toEqual(first);
  });

  it("keeps generated positions inside the page footprint", () => {
    const trees = generateTreeInstances(footprint, settings, settings.maxInstances, undefined, sampler, 32);
    expect(trees.length).toBeGreaterThan(0);
    for (const tree of trees) {
      expect(tree.position[0]).toBeGreaterThanOrEqual(footprint.minX);
      expect(tree.position[0]).toBeLessThan(footprint.maxX);
      expect(tree.position[2]).toBeGreaterThanOrEqual(footprint.minZ);
      expect(tree.position[2]).toBeLessThan(footprint.maxZ);
    }
  });

  it("records slope, height, and material rejections", () => {
    const slopeStats = { generatedCandidates: 0, acceptedCandidates: 0, rejectedSlope: 0, rejectedHeight: 0, rejectedMaterial: 0 };
    generateTreeInstances(footprint, { ...settings, placement: { ...settings.placement, slopeMinY: 0.9 } }, 1000, slopeStats, {
      ...sampler,
      surfaceNormal: () => [0, 0.5, 0],
    }, 32);
    expect(slopeStats.rejectedSlope).toBe(slopeStats.generatedCandidates);

    const heightStats = { generatedCandidates: 0, acceptedCandidates: 0, rejectedSlope: 0, rejectedHeight: 0, rejectedMaterial: 0 };
    generateTreeInstances(footprint, { ...settings, placement: { ...settings.placement, minHeightM: 30 } }, 1000, heightStats, sampler, 32);
    expect(heightStats.rejectedHeight).toBe(heightStats.generatedCandidates);

    const materialStats = { generatedCandidates: 0, acceptedCandidates: 0, rejectedSlope: 0, rejectedHeight: 0, rejectedMaterial: 0 };
    generateTreeInstances(footprint, settings, 1000, materialStats, {
      ...sampler,
      materialWeights: () => [0, 0, 0, 1],
    }, 32);
    expect(materialStats.rejectedMaterial).toBe(materialStats.generatedCandidates);
  });

  it("selects species deterministically and respects enabled species", () => {
    expect(selectTreeSpecies(settings, 0.1)).toBe(selectTreeSpecies(settings, 0.1));
    const pineOnly = {
      ...settings,
      species: {
        oak: { ...settings.species.oak, enabled: false },
        pine: { ...settings.species.pine, enabled: true },
        dead: { ...settings.species.dead, enabled: false },
      },
    };
    const trees = generateTreeInstances(footprint, pineOnly, pineOnly.maxInstances, undefined, sampler, 32);
    expect(trees.length).toBeGreaterThan(0);
    expect(new Set(trees.map((tree) => tree.species))).toEqual(new Set(["pine"]));
  });

  it("keeps generated, accepted, and rejected counts coherent", () => {
    const stats = { generatedCandidates: 0, acceptedCandidates: 0, rejectedSlope: 0, rejectedHeight: 0, rejectedMaterial: 0 };
    const trees = generateTreeInstances(footprint, settings, settings.maxInstances, stats, sampler, 32);
    expect(stats.acceptedCandidates).toBe(trees.length);
    expect(stats.generatedCandidates).toBe(
      stats.acceptedCandidates + stats.rejectedSlope + stats.rejectedHeight + stats.rejectedMaterial,
    );
  });
});

describe("tree geometry", () => {
  it("generates deterministic alpha mask atlases with oak and pine cutouts", () => {
    const first = createTreeFoliageAtlas(settings);
    const second = createTreeFoliageAtlas(settings);
    try {
      const firstData = first.texture.image.data as Uint8Array;
      const secondData = second.texture.image.data as Uint8Array;
      expect(first.texture.image.width).toBe(settings.foliage.textureAtlasColumns * settings.foliage.maskResolutionPx);
      expect(first.texture.image.height).toBe(settings.foliage.textureAtlasRows * settings.foliage.maskResolutionPx);
      expect(Array.from(firstData)).toEqual(Array.from(secondData));
      expect(alphaRange(firstData).min).toBe(0);
      expect(alphaRange(firstData).max).toBeGreaterThanOrEqual(250);
      expect(atlasCellAlpha(firstData, first.texture.image.width, settings.foliage.maskResolutionPx, 0))
        .not.toEqual(atlasCellAlpha(firstData, first.texture.image.width, settings.foliage.maskResolutionPx, 4));
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  it("is deterministic for the same settings", () => {
    const first = createTreeGeometryMap(settings);
    const second = createTreeGeometryMap(settings);
    try {
      for (const species of TREE_SPECIES) {
        for (const lod of TREE_LODS) {
          expect(geometrySnapshot(first[species][lod])).toEqual(geometrySnapshot(second[species][lod]));
        }
      }
    } finally {
      disposeTreeGeometryMap(first);
      disposeTreeGeometryMap(second);
    }
  });

  it("changes geometry output when the seed changes", () => {
    // The procedural grammar trees are grown from `settings.seed`, so reseeding
    // must produce different bark/foliage geometry.
    const base = createTreeGeometryMap(settings);
    const changedSettings: TreeSettings = { ...settings, seed: settings.seed + 1 };
    const changed = createTreeGeometryMap(changedSettings);
    try {
      expect(geometrySnapshot(changed.oak.near)).not.toEqual(geometrySnapshot(base.oak.near));
    } finally {
      disposeTreeGeometryMap(base);
      disposeTreeGeometryMap(changed);
    }
  });

  it("includes required attributes that match position counts for every species and LOD", () => {
    const geometries = createTreeGeometryMap(settings);
    try {
      for (const species of TREE_SPECIES) {
        for (const lod of TREE_LODS) {
          const geometry = geometries[species][lod];
          const position = geometry.getAttribute("position");
          const normal = geometry.getAttribute("normal");
          const color = geometry.getAttribute("color");
          const uv = geometry.getAttribute("uv");
          const wind = geometry.getAttribute("treeWind");
          const foliageMask = geometry.getAttribute("treeFoliageMask");
          const index = geometry.getIndex();
          expect(position).toBeDefined();
          expect(normal).toBeDefined();
          expect(color).toBeDefined();
          expect(uv).toBeDefined();
          expect(wind).toBeDefined();
          expect(wind.itemSize).toBe(2);
          expect(foliageMask).toBeDefined();
          expect(normal.count).toBe(position.count);
          expect(color.count).toBe(position.count);
          expect(uv.count).toBe(position.count);
          expect(wind.count).toBe(position.count);
          expect(foliageMask.count).toBe(position.count);
          expect(index).toBeDefined();
          expect(index!.count).toBeGreaterThan(0);
        }
      }
    } finally {
      disposeTreeGeometryMap(geometries);
    }
  });

  it("reduces oak and pine vertex counts by LOD", () => {
    const geometries = createTreeGeometryMap(settings);
    try {
      for (const species of ["oak", "pine"] as const) {
        const near = treeGeometrySummary(geometries[species].near).vertexCount;
        const mid = treeGeometrySummary(geometries[species].mid).vertexCount;
        const far = treeGeometrySummary(geometries[species].far).vertexCount;
        const impostor = treeGeometrySummary(geometries[species].impostor).vertexCount;
        expect(near).toBeGreaterThan(mid);
        expect(mid).toBeGreaterThan(far);
        expect(far).toBeGreaterThanOrEqual(impostor);
      }
      expect(treeGeometrySummary(geometries.dead.near).vertexCount)
        .toBeGreaterThanOrEqual(treeGeometrySummary(geometries.dead.mid).vertexCount);
      expect(treeGeometrySummary(geometries.dead.far).vertexCount).toBeLessThan(500);
      expect(treeGeometrySummary(geometries.dead.impostor).vertexCount)
        .toBeLessThanOrEqual(settings.lod.budgets.impostorMaxVertices);
    } finally {
      disposeTreeGeometryMap(geometries);
    }
  });

  it("keeps species flutter behavior bounded", () => {
    const geometries = createTreeGeometryMap(settings);
    try {
      expect(treeGeometrySummary(geometries.oak.near).maxFlutterWeight).toBeGreaterThan(0);
      expect(treeGeometrySummary(geometries.oak.mid).maxFlutterWeight).toBeGreaterThan(0);
      expect(treeGeometrySummary(geometries.pine.near).maxFlutterWeight).toBeGreaterThan(0);
      expect(treeGeometrySummary(geometries.pine.mid).maxFlutterWeight).toBeGreaterThan(0);
      for (const lod of TREE_LODS) {
        expect(treeGeometrySummary(geometries.dead[lod]).maxFlutterWeight).toBeLessThanOrEqual(0.1);
      }
    } finally {
      disposeTreeGeometryMap(geometries);
    }
  });

  it("marks foliage cards without applying foliage masks to dead trees", () => {
    const geometries = createTreeGeometryMap(settings);
    try {
      for (const lod of TREE_LODS) {
        expect(treeGeometrySummary(geometries.oak[lod]).maxFoliageMask).toBe(1);
        expect(treeGeometrySummary(geometries.pine[lod]).maxFoliageMask).toBe(1);
        expect(treeGeometrySummary(geometries.dead[lod]).maxFoliageMask).toBe(0);
        expect(minAttributeValue(geometries.oak[lod].getAttribute("treeFoliageMask"))).toBe(0);
        expect(minAttributeValue(geometries.pine[lod].getAttribute("treeFoliageMask"))).toBe(0);
      }
    } finally {
      disposeTreeGeometryMap(geometries);
    }
  });

  it("keeps tree UVs finite (bark tiles; foliage atlas retired)", () => {
    // Procedural grammar bark tiles its UVs (>1 is fine — the material reads bark
    // via triplanar, and real-mesh foliage no longer samples an atlas). The
    // impostor LOD still uses [0,1] atlas-frame UVs.
    const geometries = createTreeGeometryMap(settings);
    try {
      for (const species of TREE_SPECIES) {
        for (const lod of TREE_LODS) {
          const uv = geometries[species][lod].getAttribute("uv");
          expect(attributeValuesAreFinite(uv)).toBe(true);
          if (lod === "impostor") {
            for (let i = 0; i < uv.count; i++) {
              expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
              expect(uv.getX(i)).toBeLessThanOrEqual(1);
              expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
              expect(uv.getY(i)).toBeLessThanOrEqual(1);
            }
          }
        }
      }
    } finally {
      disposeTreeGeometryMap(geometries);
    }
  });

  it("keeps wind and flutter weights finite", () => {
    const geometries = createTreeGeometryMap(settings);
    try {
      for (const species of TREE_SPECIES) {
        for (const lod of TREE_LODS) {
          const geometry = geometries[species][lod];
          // treeWind packs wind weight in x, flutter weight in y.
          const wind = geometry.getAttribute("treeWind");
          expect(maxAttributeValue(wind)).toBeGreaterThan(0);
          expect(attributeValuesAreFinite(wind)).toBe(true);
          let flutterFinite = true;
          for (let i = 0; i < wind.count; i++) {
            if (!Number.isFinite(wind.getY(i))) flutterFinite = false;
          }
          expect(flutterFinite).toBe(true);
        }
      }
    } finally {
      disposeTreeGeometryMap(geometries);
    }
  });

  it("keeps generated tree geometry inside guardrail budgets", () => {
    const geometries = createTreeGeometryMap(settings);
    try {
      for (const species of TREE_SPECIES) {
        expect(treeGeometrySummary(geometries[species].near).vertexCount)
          .toBeLessThanOrEqual(settings.lod.budgets.nearMaxVertices);
        expect(treeGeometrySummary(geometries[species].mid).vertexCount)
          .toBeLessThanOrEqual(settings.lod.budgets.midMaxVertices);
        expect(treeGeometrySummary(geometries[species].far).vertexCount)
          .toBeLessThanOrEqual(settings.lod.budgets.farMaxVertices);
        expect(treeGeometrySummary(geometries[species].impostor).vertexCount)
          .toBeLessThanOrEqual(settings.lod.budgets.impostorMaxVertices);
      }
    } finally {
      disposeTreeGeometryMap(geometries);
    }
  });
});

describe("tree materials", () => {
  it("injects tree wind uniforms and local vertex displacement", () => {
    const shader = injectTreeWindShader(`
#include <common>
void main() {
  vec3 transformed = vec3(position);
  #include <begin_vertex>
}`);

    expect(shader).toContain("uniform float uTreeTime");
    expect(shader).toContain("uniform vec2 uTreeWindDirection");
    expect(shader).toContain("attribute vec2 treeWind");
    expect(shader).toContain("attribute vec2 treeWorldXZ");
    expect(shader).toContain("treeInstanceWorldXZ = treeWorldXZ");
    expect(shader).not.toContain("instanceMatrix[3].xz");
    expect(shader).toContain("transformed.xz +=");
  });

  it("keeps regular and debug tree materials double-sided and opaque", () => {
    const handle = createTreeMaterialHandle(settings);
    try {
      expect(handle.regularMaterial.side).toBe(THREE.DoubleSide);
      expect(handle.regularMaterial.transparent).toBe(false);
      expect(handle.regularMaterial.depthWrite).toBe(true);
      // Foliage is real leaf/needle geometry now (opaque, vertex-colour); the
      // alpha-card atlas + cutout is retired, so no alpha test and no map.
      expect(handle.regularMaterial.alphaTest).toBe(0);
      expect((handle.regularMaterial as THREE.MeshStandardMaterial).map).toBeNull();
      for (const material of Object.values(handle.debugMaterials)) {
        expect(material.side).toBe(THREE.DoubleSide);
        expect(material.transparent).toBe(false);
      }
      expect((handle.debugMaterials.impostor as THREE.MeshBasicMaterial).color.getHex())
        .not.toBe((handle.debugMaterials.far as THREE.MeshBasicMaterial).color.getHex());
    } finally {
      handle.dispose();
    }
  });

  it("injects foliage mask shader protection for alpha cutouts", () => {
    const vertex = injectTreeFoliageVertexShader(`
#include <common>
void main() {
  #include <begin_vertex>
}`);
    const fragment = injectTreeFoliageFragmentShader(`
#include <common>
void main() {
  vec4 diffuseColor = vec4(1.0);
  #include <map_fragment>
}`);

    expect(vertex).toContain("attribute float treeFoliageMask");
    expect(vertex).toContain("varying float vTreeFoliageMask");
    expect(fragment).toContain("varying float vTreeFoliageMask");
    expect(fragment).toContain("mix(1.0, diffuseColor.a");
  });
});

describe("TreeSystem", () => {
  it("selects GPU ring mode only when all required GPU flags are enabled", () => {
    const eligible = {
      ...settings,
      gpu: {
        ...settings.gpu,
        enabled: true,
        scatterEnabled: true,
        cullEnabled: true,
        debugForceCpu: false,
      },
    };

    expect(treeUsesGpuRingDraw({ ...eligible, gpu: { ...eligible.gpu, enabled: false } })).toBe(false);
    expect(treeUsesGpuRingDraw({ ...eligible, gpu: { ...eligible.gpu, scatterEnabled: false } })).toBe(false);
    expect(treeUsesGpuRingDraw({ ...eligible, gpu: { ...eligible.gpu, cullEnabled: false } })).toBe(false);
    expect(treeUsesGpuRingDraw({ ...eligible, gpu: { ...eligible.gpu, debugForceCpu: true } })).toBe(false);
    expect(treeUsesGpuRingDraw(eligible)).toBe(true);
  });

  it("reports CPU fallback when GPU trees are enabled but scatter or cull is disabled", () => {
    for (const gpuOverride of [{ scatterEnabled: false }, { cullEnabled: false }]) {
      const system = new TreeSystem({
        scene: new THREE.Scene(),
        nodes: [pageNode()],
        worldCells: 32,
        settings: {
          ...settings,
          maxInstances: 100,
          distanceM: 80,
          gpu: {
            ...settings.gpu,
            enabled: true,
            fallbackToCpu: true,
            scatterEnabled: true,
            cullEnabled: true,
            ...gpuOverride,
          },
        },
        sampler,
        supportsGpuTrees: false,
        gpuDevice: null,
      });
      try {
        system.update(0, new THREE.Vector3(16, 0, 16));
        expect(system.getStats().gpuStatus).toBe("fallback-cpu");
      } finally {
        system.dispose();
      }
    }
  });

  it("packs real GPU frustum planes and keeps the no-camera fallback conservative", () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);

    const planes = packTreeGpuFrustumPlanes(camera);
    expect([...planes].every(Number.isFinite)).toBe(true);
    expect(pointPassesPlanes(planes, new THREE.Vector3(0, 0, -5))).toBe(true);
    expect(pointPassesPlanes(planes, new THREE.Vector3(0, 0, 5))).toBe(false);
    expect(pointPassesPlanes(planes, new THREE.Vector3(1000, 0, -5))).toBe(false);

    const fallback = packTreeGpuFrustumPlanes();
    expect(pointPassesPlanes(fallback, new THREE.Vector3(1_000_000, -1_000_000, 1_000_000))).toBe(true);
  });

  it("uses patch-local instance matrices and keeps tree counts stable", () => {
    const scene = new THREE.Scene();
    const localSettings = { ...settings, maxInstances: 100, distanceM: 80 };
    const node = pageNode();
    const system = new TreeSystem({
      scene,
      nodes: [node],
      worldCells: 32,
      settings: localSettings,
      sampler,
    });
    try {
      const expectedTrees = generateTreeInstances(footprint, localSettings, localSettings.maxInstances, undefined, sampler, 32);
      expect(expectedTrees.length).toBeGreaterThan(0);
      const patchGroup = scene.getObjectByName("tree-patch-L0:0,0");
      expect(patchGroup).toBeDefined();
      expect(patchGroup?.position.x).toBeCloseTo(16);
      expect(patchGroup?.position.z).toBeCloseTo(16);

      const firstTree = expectedTrees[0];
      const lod = treeLodForPosition(firstTree.position, new THREE.Vector3(16, 0, 16), localSettings);
      const mesh = instancedTreeMeshes(scene).find((candidate) =>
        candidate.name === `trees-L0:0,0-${firstTree.species}-${lod}`,
      );
      expect(mesh).toBeDefined();
      const matrix = new THREE.Matrix4();
      mesh!.getMatrixAt(0, matrix);
      const translation = new THREE.Vector3().setFromMatrixPosition(matrix);
      expect(translation.x).toBeCloseTo(firstTree.position[0] - 16);
      expect(translation.y).toBeCloseTo(firstTree.position[1]);
      expect(translation.z).toBeCloseTo(firstTree.position[2] - 16);
      expect(system.getStats().totalTrees).toBe(expectedTrees.length);
    } finally {
      system.dispose();
    }
  });

  it("uses double-sided far card materials and valid instanced frustum bounds", () => {
    const scene = new THREE.Scene();
    const system = new TreeSystem({
      scene,
      nodes: [pageNode()],
      worldCells: 32,
      settings: { ...settings, maxInstances: 100, distanceM: 80 },
      sampler,
    });
    try {
      const meshes = instancedTreeMeshes(scene);
      expect(meshes).toHaveLength(TREE_SPECIES.length * TREE_LODS.length);
      expect(meshes.every((mesh) => mesh.frustumCulled === true)).toBe(true);

      const farMeshes = meshes.filter((mesh) => mesh.name.endsWith("-far"));
      expect(farMeshes).toHaveLength(TREE_SPECIES.length);
      for (const mesh of farMeshes) {
        const material = mesh.material as THREE.Material;
        expect(material.side).toBe(THREE.DoubleSide);
        expect(material.transparent).toBe(false);
      }

      const activeMeshes = meshes.filter((mesh) => mesh.count > 0);
      expect(activeMeshes.length).toBeGreaterThan(0);
      for (const mesh of activeMeshes) {
        const treeWorldXZ = mesh.geometry.getAttribute("treeWorldXZ");
        expect(treeWorldXZ).toBeDefined();
        expect(treeWorldXZ.itemSize).toBe(2);
        expect(mesh.boundingSphere).not.toBeNull();
        expect(mesh.boundingSphere!.radius).toBeGreaterThan(0);
        expect(Number.isFinite(mesh.boundingSphere!.radius)).toBe(true);
        expect(mesh.boundingBox).not.toBeNull();
        expect(mesh.boundingBox!.isEmpty()).toBe(false);
      }
    } finally {
      system.dispose();
    }
  });

  it("keeps bounds finite and local to an offset tree patch", () => {
    const scene = new THREE.Scene();
    const offsetFootprint: PageFootprint = { minX: 1000, minZ: 2000, maxX: 1032, maxZ: 2032 };
    const system = new TreeSystem({
      scene,
      nodes: [pageNode(pageMesh(), offsetFootprint)],
      worldCells: 4096,
      settings: { ...settings, maxInstances: 100, distanceM: 80 },
      sampler,
    });
    try {
      system.update(0, new THREE.Vector3(1016, 0, 2016));
      const patchGroup = scene.getObjectByName("tree-patch-L0:0,0");
      expect(patchGroup?.position.x).toBeCloseTo(1016);
      expect(patchGroup?.position.z).toBeCloseTo(2016);

      const mesh = instancedTreeMeshes(scene).find((candidate) => candidate.count > 0);
      expect(mesh).toBeDefined();
      const treeWorldXZ = mesh!.geometry.getAttribute("treeWorldXZ");
      expect(treeWorldXZ).toBeDefined();
      expect(treeWorldXZ.itemSize).toBe(2);
      expect(treeWorldXZ.getX(0)).toBeGreaterThanOrEqual(offsetFootprint.minX);
      expect(treeWorldXZ.getX(0)).toBeLessThan(offsetFootprint.maxX);
      expect(treeWorldXZ.getY(0)).toBeGreaterThanOrEqual(offsetFootprint.minZ);
      expect(treeWorldXZ.getY(0)).toBeLessThan(offsetFootprint.maxZ);
      expect(mesh!.boundingSphere).not.toBeNull();
      expect(mesh!.boundingSphere!.radius).toBeGreaterThan(0);
      expect(mesh!.boundingSphere!.radius).toBeLessThan(80);
      expect(Math.abs(mesh!.boundingSphere!.center.x)).toBeLessThan(32);
      expect(Math.abs(mesh!.boundingSphere!.center.z)).toBeLessThan(32);
      expect(mesh!.boundingBox).not.toBeNull();
      expect(mesh!.boundingBox!.isEmpty()).toBe(false);
    } finally {
      system.dispose();
    }
  });

  it("uses double-sided debug LOD materials", () => {
    const scene = new THREE.Scene();
    const system = new TreeSystem({
      scene,
      nodes: [pageNode()],
      worldCells: 32,
      settings: {
        ...settings,
        maxInstances: 100,
        distanceM: 80,
        render: { ...settings.render, debugColorByLod: true },
      },
      sampler,
    });
    try {
      const meshes = instancedTreeMeshes(scene);
      expect(meshes).toHaveLength(TREE_SPECIES.length * TREE_LODS.length);
      for (const mesh of meshes) {
        const material = mesh.material as THREE.Material;
        expect(material.side).toBe(THREE.DoubleSide);
        expect(material.transparent).toBe(false);
      }
    } finally {
      system.dispose();
    }
  });

  it("counts impostor LOD trees and keeps visible counts coherent", () => {
    const scene = new THREE.Scene();
    const localSettings = { ...settings, maxInstances: 100, distanceM: 160 };
    const system = new TreeSystem({
      scene,
      nodes: [pageNode()],
      worldCells: 32,
      settings: localSettings,
      sampler,
    });
    try {
      system.update(0, new THREE.Vector3(-105, 0, 16));
      const stats = system.getStats();
      expect(stats.impostorTrees).toBeGreaterThan(0);
      expect(stats.nearTrees + stats.midTrees + stats.farTrees + stats.impostorTrees).toBe(stats.totalTrees);
    } finally {
      system.dispose();
    }
  });

  it("applies shadows_max_lod to tree meshes", () => {
    const cases = [
      { shadowsMaxLod: "none", enabled: [] },
      { shadowsMaxLod: "near", enabled: ["near"] },
      { shadowsMaxLod: "mid", enabled: ["near", "mid"] },
      { shadowsMaxLod: "impostor", enabled: ["near", "mid", "far", "impostor"] },
    ] as const;

    for (const testCase of cases) {
      const scene = new THREE.Scene();
      const system = new TreeSystem({
        scene,
        nodes: [pageNode()],
        worldCells: 32,
        settings: {
          ...settings,
          maxInstances: 20,
          lod: { ...settings.lod, shadowsMaxLod: testCase.shadowsMaxLod },
        },
        sampler,
      });
      try {
        const expected = new Set<string>(testCase.enabled);
        for (const mesh of instancedTreeMeshes(scene)) {
          const lod = mesh.name.split("-").at(-1);
          expect(mesh.castShadow).toBe(expected.has(lod ?? ""));
        }
      } finally {
        system.dispose();
      }
    }
  });

  it("does not mutate CLOD page meshes", () => {
    const mesh = pageMesh();
    const before = meshSnapshot(mesh);
    const scene = new THREE.Scene();
    const system = new TreeSystem({
      scene,
      nodes: [pageNode(mesh)],
      worldCells: 32,
      settings: { ...settings, maxInstances: 100, distanceM: 80 },
      sampler,
    });
    try {
      system.update(0, new THREE.Vector3(16, 0, 16));
      expect(meshSnapshot(mesh)).toEqual(before);
    } finally {
      system.dispose();
    }
  });

  it("rebuildNodePatches removes only affected CPU patches", () => {
    const scene = new THREE.Scene();
    const secondFootprint: PageFootprint = { minX: 32, minZ: 0, maxX: 64, maxZ: 32 };
    const firstNode = pageNode();
    const secondNode = { ...pageNode(pageMesh(), secondFootprint), id: "L0:1,0" };
    const system = new TreeSystem({
      scene,
      nodes: [firstNode, secondNode],
      worldCells: 64,
      settings: {
        ...settings,
        maxInstances: 1000,
        maxNewPatchesPerFrame: 10,
        distanceM: 96,
      },
      sampler,
    });
    try {
      const firstBefore = scene.getObjectByName("tree-patch-L0:0,0");
      const secondBefore = scene.getObjectByName("tree-patch-L0:1,0");
      expect(firstBefore).toBeDefined();
      expect(secondBefore).toBeDefined();

      system.rebuildNodePatches(["L0:0,0"]);

      expect(scene.getObjectByName("tree-patch-L0:0,0")).toBeDefined();
      expect(scene.getObjectByName("tree-patch-L0:0,0")).not.toBe(firstBefore);
      expect(scene.getObjectByName("tree-patch-L0:1,0")).toBe(secondBefore);
      expect(system.getStats().patches).toBe(2);
    } finally {
      system.dispose();
    }
  });

  it("invalidates GPU ring tree state on node rebuild without refreshing CPU patches", () => {
    const scene = new THREE.Scene();
    const system = new TreeSystem({
      scene,
      nodes: [pageNode()],
      worldCells: 32,
      settings: {
        ...settings,
        maxInstances: 100,
        distanceM: 80,
        gpu: {
          ...settings.gpu,
          enabled: true,
          fallbackToCpu: true,
        },
      },
      sampler,
      supportsGpuTrees: true,
      gpuDevice: fakeGpuDevice(),
      gpuBackend: {} as never,
    });
    const internal = system as unknown as {
      root: THREE.Group;
      ringMeshes: THREE.Mesh[];
      gpuRingCompute: { destroy: () => void } | null;
      gpuRingDraw: unknown;
      gpuRingKey: string;
      gpuRingStats: { status: string };
    };
    const destroyCompute = vi.fn();
    const disposeMaterial = vi.fn();
    const ringMesh = new THREE.Mesh(new THREE.InstancedBufferGeometry(), new THREE.MeshBasicMaterial());
    internal.root.add(ringMesh);
    internal.ringMeshes = [ringMesh];
    internal.gpuRingCompute = { destroy: destroyCompute };
    internal.gpuRingDraw = {
      materialHandles: {
        near: { dispose: disposeMaterial },
        mid: { dispose: disposeMaterial },
        far: { dispose: disposeMaterial },
        impostor: { dispose: disposeMaterial },
      },
    };
    internal.gpuRingKey = "stale-key";

    try {
      system.rebuildNodePatches(["L0:0,0"]);

      expect(destroyCompute).toHaveBeenCalledTimes(1);
      expect(disposeMaterial).toHaveBeenCalledTimes(4);
      expect(internal.root.children).not.toContain(ringMesh);
      expect(internal.ringMeshes).toEqual([]);
      expect(internal.gpuRingCompute).toBeNull();
      expect(internal.gpuRingDraw).toBeNull();
      expect(internal.gpuRingKey).toBe("");
      expect(internal.gpuRingStats.status).toBe("idle");
      expect(scene.getObjectByName("tree-patch-L0:0,0")).toBeUndefined();
      expect(system.getStats().patches).toBe(0);
      expect(system.getStats().gpuStatus).toBe("ring");
    } finally {
      system.dispose();
    }
  });

  it("invalidates GPU ring mode safely when no GPU device exists", () => {
    const scene = new THREE.Scene();
    const system = new TreeSystem({
      scene,
      nodes: [pageNode()],
      worldCells: 32,
      settings: {
        ...settings,
        maxInstances: 100,
        distanceM: 80,
        gpu: {
          ...settings.gpu,
          enabled: true,
          fallbackToCpu: true,
        },
      },
      sampler,
      supportsGpuTrees: false,
      gpuDevice: null,
    });
    try {
      expect(() => system.rebuildNodePatches(["L0:0,0"])).not.toThrow();
      const stats = system.getStats();
      expect(stats.patches).toBe(0);
      expect(stats.gpuStatus).toBe("fallback-cpu");
      expect(scene.getObjectByName("tree-patch-L0:0,0")).toBeUndefined();
    } finally {
      system.dispose();
    }
  });

  it("can initialize GPU ring again on the update after terrain edit invalidation", () => {
    const scene = new THREE.Scene();
    const system = new TreeSystem({
      scene,
      nodes: [pageNode()],
      worldCells: 32,
      settings: {
        ...settings,
        maxInstances: 100,
        distanceM: 80,
        gpu: {
          ...settings.gpu,
          enabled: true,
          fallbackToCpu: true,
        },
      },
      sampler,
      supportsGpuTrees: true,
      gpuDevice: fakeGpuDevice(),
      gpuBackend: {} as never,
    });
    const dispatch = vi.fn(() => true);
    const stats = fakeRingStats();
    const internal = system as unknown as {
      ensureGpuRingCompute: () => void;
      gpuRingCompute: unknown;
      gpuRingDraw: unknown;
      gpuRingStats: typeof stats;
    };
    let ensureCalls = 0;
    internal.ensureGpuRingCompute = () => {
      ensureCalls++;
      internal.gpuRingStats = stats;
      internal.gpuRingCompute = {
        stats: () => stats,
        dispatch,
        destroy: vi.fn(),
      };
      internal.gpuRingDraw = {};
    };

    try {
      system.rebuildNodePatches(["L0:0,0"]);
      system.update(1, new THREE.Vector3(16, 0, 16));

      expect(ensureCalls).toBe(1);
      expect(dispatch).toHaveBeenCalledTimes(1);
      const nextStats = system.getStats();
      expect(nextStats.gpuStatus).toBe("ring");
      expect(nextStats.gpuVisibleCount).toBe(3);
      expect(nextStats.patches).toBe(0);
      expect(scene.getObjectByName("tree-patch-L0:0,0")).toBeUndefined();
    } finally {
      system.dispose();
    }
  });

  it("falls back to CPU tree LODs when GPU trees are enabled without a device", () => {
    const scene = new THREE.Scene();
    const system = new TreeSystem({
      scene,
      nodes: [pageNode()],
      worldCells: 32,
      settings: {
        ...settings,
        maxInstances: 100,
        distanceM: 80,
        gpu: {
          ...settings.gpu,
          enabled: true,
          fallbackToCpu: true,
        },
      },
      sampler,
      supportsGpuTrees: false,
      gpuDevice: null,
    });
    try {
      system.update(0, new THREE.Vector3(16, 0, 16));
      const stats = system.getStats();
      expect(stats.gpuStatus).toBe("fallback-cpu");
      expect(stats.nearTrees + stats.midTrees + stats.farTrees + stats.impostorTrees).toBe(stats.totalTrees);
    } finally {
      system.dispose();
    }
  });

  it("reports GPU ring stats from readback counts without CPU patches", () => {
    const scene = new THREE.Scene();
    const system = new TreeSystem({
      scene,
      nodes: [pageNode()],
      worldCells: 128,
      settings: {
        ...settings,
        gpu: { ...settings.gpu, enabled: true, fallbackToCpu: false },
      },
      sampler,
    });
    try {
      const internals = system as unknown as {
        gpuStatus: "ring";
        gpuVisibleCount: number;
        gpuRingStats: TreeGpuRingStats;
        lodCounts: Record<TreeLod, number>;
        updateStats(): void;
      };
      internals.gpuStatus = "ring";
      internals.gpuVisibleCount = 37;
      internals.gpuRingStats = {
        status: "ready",
        candidateCount: 121,
        acceptedCandidates: 37,
        counts: { near: 5, mid: 11, far: 13, impostor: 8 },
        groupCounts: [],
        overflowed: false,
        dispatchMs: 1.25,
        readbackMs: 0.5,
        skippedDispatches: 0,
      };
      internals.lodCounts.near = 5;
      internals.lodCounts.mid = 11;
      internals.lodCounts.far = 13;
      internals.lodCounts.impostor = 8;
      internals.updateStats();

      const stats = system.getStats();
      expect(stats.patches).toBe(0);
      expect(stats.visiblePatches).toBe(0);
      expect(stats.generatedCandidates).toBe(121);
      expect(stats.acceptedCandidates).toBe(37);
      expect(stats.totalTrees).toBe(37);
      expect(stats.gpuCandidateCount).toBe(121);
      expect(stats.gpuAcceptedCount).toBe(37);
      expect(stats.gpuVisibleCount).toBe(37);
      expect(stats.nearTrees).toBe(5);
      expect(stats.midTrees).toBe(11);
      expect(stats.farTrees).toBe(13);
      expect(stats.impostorTrees).toBe(8);
    } finally {
      system.dispose();
    }
  });

  it("keeps CPU patch stats unchanged when GPU is disabled", () => {
    const scene = new THREE.Scene();
    const system = new TreeSystem({
      scene,
      nodes: [pageNode()],
      worldCells: 32,
      settings: { ...settings, maxInstances: 100, distanceM: 80 },
      sampler,
    });
    try {
      const expectedTrees = generateTreeInstances(footprint, { ...settings, maxInstances: 100, distanceM: 80 }, 100, undefined, sampler, 32);
      const stats = system.getStats();
      expect(stats.totalTrees).toBe(expectedTrees.length);
      expect(stats.generatedCandidates).toBeGreaterThanOrEqual(stats.acceptedCandidates);
      expect(stats.gpuCandidateCount).toBe(0);
      expect(stats.gpuAcceptedCount).toBe(0);
      expect(stats.gpuVisibleCount).toBe(0);
    } finally {
      system.dispose();
    }
  });

  it("formats tree stats for the main HUD line", () => {
    expect(formatTreeInfoLine(true, 1234, {
      totalTrees: 1234,
      patches: 9,
      visiblePatches: 4,
      culledPatches: 5,
      nearTrees: 11,
      midTrees: 22,
      farTrees: 33,
      impostorTrees: 0,
      gpuStatus: "ring",
      gpuCandidateCount: 44,
      gpuAcceptedCount: 40,
      gpuVisibleCount: 37,
      gpuOverflowed: false,
      gpuDispatchMs: null,
      gpuShowCounts: true,
      impostorStatus: "disabled",
      impostorReason: null,
      generatedCandidates: 1234,
      acceptedCandidates: 1234,
      rejectedSlope: 0,
      rejectedHeight: 0,
      rejectedMaterial: 0,
    })).toBe("trees: enabled 1,234 trees patches=4/9 lod n/m/f/i=11/22/33/0 gpu=ring candidates=44 accepted=40 visible=37");
    const hiddenGpuStats = {
      totalTrees: 0,
      patches: 0,
      visiblePatches: 0,
      culledPatches: 0,
      nearTrees: 0,
      midTrees: 0,
      farTrees: 0,
      impostorTrees: 0,
      gpuStatus: "ring" as const,
      gpuCandidateCount: 0,
      gpuAcceptedCount: 0,
      gpuVisibleCount: 0,
      gpuOverflowed: false,
      gpuDispatchMs: null,
      gpuShowCounts: false,
      impostorStatus: "disabled" as const,
      impostorReason: null,
      generatedCandidates: 0,
      acceptedCandidates: 0,
      rejectedSlope: 0,
      rejectedHeight: 0,
      rejectedMaterial: 0,
    };
    expect(formatTreeTotalDisplay(hiddenGpuStats)).toBe("counts off");
    expect(formatTreeInfoLine(true, formatTreeTotalDisplay(hiddenGpuStats), hiddenGpuStats)).toBe("trees: enabled gpu=ring counts=off");
    expect(formatTreeInfoLine(false, 0, null)).toBe("trees: disabled 0 trees");
  });
});

describe("GPU tree ring lighting proxies", () => {
  function proxySettings(seed = 10): TreeSettings {
    return {
      ...settings,
      seed,
      enabled: true,
      distanceM: 120,
      gpu: { ...settings.gpu, enabled: true, fallbackToCpu: false },
      ecology: {
        ...settings.ecology,
        density: { ...settings.ecology.density, baseDensity: 1 },
        clustering: {
          ...settings.ecology.clustering,
          clusterStrength: 0,
          clusterThreshold: 0,
        },
      },
      species: {
        oak: { ...settings.species.oak, minHeightM: 0, maxHeightM: 80 },
        pine: { ...settings.species.pine, minHeightM: 0, maxHeightM: 80 },
        dead: { ...settings.species.dead, minHeightM: 0, maxHeightM: 80 },
      },
    };
  }

  it("is deterministic, seed/center sensitive, finite, valid, and bounded", () => {
    const base = {
      centerX: 64,
      centerZ: 64,
      worldCells: 256,
      settings: proxySettings(),
      sampler,
    };
    const first = generateTreeRingLightingProxies(base);
    const second = generateTreeRingLightingProxies(base);
    const reseeded = generateTreeRingLightingProxies({ ...base, settings: proxySettings(11) });
    const recentered = generateTreeRingLightingProxies({ ...base, centerX: 96, centerZ: 96 });

    expect(first.length).toBeGreaterThan(0);
    expect(first).toEqual(second);
    expect(first).not.toEqual(reseeded);
    expect(first).not.toEqual(recentered);
    expect(first.length).toBeLessThanOrEqual(TREE_GPU_RING_LIGHTING_PROXY_CAP);
    for (const proxy of first) {
      expect(Number.isFinite(proxy.x)).toBe(true);
      expect(Number.isFinite(proxy.z)).toBe(true);
      expect(Number.isFinite(proxy.height)).toBe(true);
      expect(Number.isFinite(proxy.scale)).toBe(true);
      expect(Number.isFinite(proxy.crownRadius)).toBe(true);
      expect(proxy.height).toBeGreaterThan(0);
      expect(proxy.scale).toBeGreaterThan(0);
      expect(TREE_SPECIES).toContain(proxy.species);
    }
  });

  it("returns no lighting proxies when trees are disabled", () => {
    const disabled = proxySettings();
    disabled.enabled = false;
    expect(generateTreeRingLightingProxies({
      centerX: 64,
      centerZ: 64,
      worldCells: 256,
      settings: disabled,
      sampler,
    })).toEqual([]);
  });

  it("returns immutable GPU ring proxy copies from TreeSystem", () => {
    const system = new TreeSystem({
      scene: new THREE.Scene(),
      nodes: [pageNode()],
      worldCells: 256,
      settings: proxySettings(),
      sampler,
    });
    try {
      (system as unknown as { gpuStatus: "ring" }).gpuStatus = "ring";
      const first = system.getLightingProxies();
      const second = system.getLightingProxies();
      expect(first.length).toBeGreaterThan(0);
      expect(first).toEqual(second);
      first[0]!.x = -999;
      expect(system.getLightingProxies()[0]!.x).not.toBe(-999);
    } finally {
      system.dispose();
    }
  });
});

describe("tree review fixes", () => {
  function collectLodFades(scene: THREE.Scene): number[] {
    const fades: number[] = [];
    for (const mesh of instancedTreeMeshes(scene)) {
      if (!mesh.visible || mesh.count === 0) continue;
      const attribute = mesh.geometry.getAttribute("treeLodFade");
      for (let i = 0; i < mesh.count; i++) fades.push(attribute.getX(i));
    }
    return fades;
  }

  it("geometry key ignores render-only changes but tracks seed/morphology/foliage (#2)", () => {
    const base = cloneTreeSettings();
    const key = treeGeometryKey(base);

    const renderOnly = cloneTreeSettings();
    renderOnly.render.debugColorByLod = !renderOnly.render.debugColorByLod;
    expect(treeGeometryKey(renderOnly)).toBe(key);

    const seeded = cloneTreeSettings();
    seeded.seed += 1;
    expect(treeGeometryKey(seeded)).not.toBe(key);

    const morphed = cloneTreeSettings();
    morphed.species.oak.morphology.branchLevels += 1;
    expect(treeGeometryKey(morphed)).not.toBe(key);

    const foliage = cloneTreeSettings();
    foliage.foliage.oak.cardCountNear += 5;
    expect(treeGeometryKey(foliage)).not.toBe(key);
  });

  it("dithers treeLodFade across the crossfade band and stays solid when disabled (#1)", () => {
    const make = (crossfadeEnabled: boolean): THREE.Scene => {
      const scene = new THREE.Scene();
      const system = new TreeSystem({
        scene,
        nodes: [pageNode()],
        worldCells: 32,
        settings: {
          ...settings,
          distanceM: 40,
          lod: { ...settings.lod, crossfadeEnabled, ditherEnabled: true, crossfadeBandM: 60 },
        },
        sampler,
      });
      system.update(0, new THREE.Vector3(16, 0, 16));
      const stats = system.getStats();
      // Primary-LOD counts still sum to the visible instance count despite the
      // crossfade secondary draws.
      expect(stats.nearTrees + stats.midTrees + stats.farTrees + stats.impostorTrees).toBe(stats.totalTrees);
      return scene;
    };

    const crossfaded = collectLodFades(make(true));
    expect(crossfaded.length).toBeGreaterThan(0);
    expect(crossfaded.some((fade) => fade > 0.001 && fade < 0.999)).toBe(true);

    const solid = collectLodFades(make(false));
    expect(solid.length).toBeGreaterThan(0);
    expect(solid.every((fade) => fade === 1)).toBe(true);
  });

  it("clamps the impostor band to far when no atlas and fallbackToPlaceholder is false (#3)", () => {
    const build = (fallbackToPlaceholder: boolean) => {
      const system = new TreeSystem({
        scene: new THREE.Scene(),
        nodes: [pageNode()],
        worldCells: 32,
        settings: {
          ...settings,
          distanceM: 40,
          lod: {
            ...settings.lod,
            crossfadeEnabled: false,
            nearFraction: 0.05,
            midFraction: 0.06,
            farFraction: 0.07,
            impostorFraction: 1.0,
          },
          impostors: { ...settings.impostors, enabled: true, bakeOnStart: false, fallbackToPlaceholder },
        },
        sampler,
      });
      system.update(0, new THREE.Vector3(16, 0, 16));
      const stats = system.getStats();
      system.dispose();
      return stats;
    };

    const withPlaceholder = build(true);
    const clamped = build(false);
    expect(withPlaceholder.impostorTrees).toBeGreaterThan(0);
    expect(clamped.impostorTrees).toBe(0);
    expect(clamped.farTrees).toBe(withPlaceholder.farTrees + withPlaceholder.impostorTrees);
  });
});

function maxAttributeValue(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): number {
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < attribute.count; i++) max = Math.max(max, attribute.getX(i));
  return max;
}

function minAttributeValue(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < attribute.count; i++) min = Math.min(min, attribute.getX(i));
  return min;
}

function attributeValuesAreFinite(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): boolean {
  for (let i = 0; i < attribute.count; i++) {
    if (!Number.isFinite(attribute.getX(i))) return false;
  }
  return true;
}

function geometrySnapshot(geometry: THREE.BufferGeometry) {
  return {
    position: Array.from(geometry.getAttribute("position").array),
    normal: Array.from(geometry.getAttribute("normal").array),
    color: Array.from(geometry.getAttribute("color").array),
    uv: Array.from(geometry.getAttribute("uv").array),
    wind: Array.from(geometry.getAttribute("treeWind").array),
    foliageMask: Array.from(geometry.getAttribute("treeFoliageMask").array),
    index: Array.from(geometry.getIndex()!.array),
  };
}

function alphaRange(data: Uint8Array): { min: number; max: number } {
  let min = 255;
  let max = 0;
  for (let i = 3; i < data.length; i += 4) {
    min = Math.min(min, data[i]);
    max = Math.max(max, data[i]);
  }
  return { min, max };
}

function atlasCellAlpha(data: Uint8Array, textureWidth: number, cellSize: number, cell: number): number[] {
  const columns = textureWidth / cellSize;
  const cellX = cell % columns;
  const cellY = Math.floor(cell / columns);
  const out: number[] = [];
  for (let y = 0; y < cellSize; y += 4) {
    for (let x = 0; x < cellSize; x += 4) {
      out.push(data[((cellY * cellSize + y) * textureWidth + cellX * cellSize + x) * 4 + 3]);
    }
  }
  return out;
}
