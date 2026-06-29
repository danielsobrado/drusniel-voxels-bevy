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
  species: Object.fromEntries(TREE_SPECIES.map((species) => [
    species,
    { ...DEFAULT_TREE_SETTINGS.species[species], minHeightM: 0, maxHeightM: 80 },
  ])) as TreeSettings["species"],
};

function pageMesh(): PageMesh {
  return {
    positions: new Float32Array([0, 24, 0, 32, 24, 0, 0, 24, 32]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    paintSlots: new Float32Array([0, 0, 0]),
    materialWeights: new Float32Array(12),
    materialWeightStride: 4,
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
      minY: 0,
      maxY: 0,
    },
    errorWorld: 0,
    lowBenefit: false,
  };
}

function meshSnapshot(mesh: PageMesh) {
  return {
    positions: [...mesh.positions],
    normals: [...mesh.normals],
    materials: [...mesh.paintSlots],
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
    submitMs: 0.25,
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
});
