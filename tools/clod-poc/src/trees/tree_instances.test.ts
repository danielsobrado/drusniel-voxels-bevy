import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { ClodPageNode, PageMesh } from "../types.js";
import type { PageFootprint } from "../types.js";
import {
  cloneTreeSettings,
  DEFAULT_TREE_SETTINGS,
  DEFAULT_TREE_WIND_SETTINGS,
  createTreeGeometryMap,
  createTreeMaterialHandle,
  disposeTreeGeometryMap,
  formatTreeInfoLine,
  generateTreeInstances,
  injectTreeWindShader,
  parseTreeConfig,
  selectTreeSpecies,
  TreeSystem,
  TREE_LODS,
  TREE_SPECIES,
  type TreeSettings,
  type TreeTerrainSampler,
} from "./index.js";
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

function treeLodForPosition(position: readonly [number, number, number], center: THREE.Vector3, treeSettings: TreeSettings): string {
  const distance = Math.hypot(center.x - position[0], center.z - position[2]);
  if (distance <= treeSettings.distanceM * treeSettings.lod.nearFraction) return "near";
  if (distance <= treeSettings.distanceM * treeSettings.lod.midFraction) return "mid";
  return "far";
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

  it("parses config/trees.yaml to the typed defaults", () => {
    expect(parseTreeConfig(treeYamlText, null)).toEqual(DEFAULT_TREE_SETTINGS);
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

    expect(parsed.lod).toEqual({
      nearFraction: 0,
      midFraction: 1,
      farFraction: 1,
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
    expect(parsed.lod.midFraction).toBeCloseTo(0.81);
    expect(parsed.lod.farFraction).toBeCloseTo(0.82);
  });

  it("keeps enabled tree far LOD distance non-zero", () => {
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
    expect(parsed.lod.farFraction).toBeGreaterThanOrEqual(0.01);
    expect(parsed.lod.farFraction).toBeGreaterThanOrEqual(parsed.lod.midFraction);
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
  it("includes wind and flutter attributes that match position counts", () => {
    const geometries = createTreeGeometryMap(settings);
    try {
      for (const species of TREE_SPECIES) {
        for (const lod of TREE_LODS) {
          const geometry = geometries[species][lod];
          const position = geometry.getAttribute("position");
          const wind = geometry.getAttribute("treeWindWeight");
          const flutter = geometry.getAttribute("treeFlutterWeight");
          expect(wind).toBeDefined();
          expect(flutter).toBeDefined();
          expect(wind.count).toBe(position.count);
          expect(flutter.count).toBe(position.count);
          expect(maxAttributeValue(wind)).toBeGreaterThan(0);
        }
      }
    } finally {
      disposeTreeGeometryMap(geometries);
    }
  });

  it("gives far oak and pine cards flutter weights", () => {
    const geometries = createTreeGeometryMap(settings);
    try {
      expect(maxAttributeValue(geometries.oak.far.getAttribute("treeFlutterWeight"))).toBeGreaterThan(0);
      expect(maxAttributeValue(geometries.pine.far.getAttribute("treeFlutterWeight"))).toBeGreaterThan(0);
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
    expect(shader).toContain("attribute float treeWindWeight");
    expect(shader).toContain("attribute float treeFlutterWeight");
    expect(shader).toContain("instanceMatrix[3].xz");
    expect(shader).toContain("transformed.xz +=");
  });

  it("keeps regular and debug tree materials double-sided and opaque", () => {
    const handle = createTreeMaterialHandle(settings);
    try {
      expect(handle.regularMaterial.side).toBe(THREE.DoubleSide);
      expect(handle.regularMaterial.transparent).toBe(false);
      for (const material of Object.values(handle.debugMaterials)) {
        expect(material.side).toBe(THREE.DoubleSide);
        expect(material.transparent).toBe(false);
      }
    } finally {
      handle.dispose();
    }
  });
});

describe("TreeSystem", () => {
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

  it("formats tree stats for the main HUD line", () => {
    expect(formatTreeInfoLine(true, 1234, {
      totalTrees: 1234,
      patches: 9,
      visiblePatches: 4,
      culledPatches: 5,
      nearTrees: 11,
      midTrees: 22,
      farTrees: 33,
      generatedCandidates: 1234,
      acceptedCandidates: 1234,
      rejectedSlope: 0,
      rejectedHeight: 0,
      rejectedMaterial: 0,
    })).toBe("trees: enabled 1,234 trees patches=4/9 lod n/m/f=11/22/33");
    expect(formatTreeInfoLine(false, 0, null)).toBe("trees: disabled 0 trees");
  });
});

function maxAttributeValue(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): number {
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < attribute.count; i++) max = Math.max(max, attribute.getX(i));
  return max;
}
