import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { ClodPageNode, PageMesh } from "../types.js";
import type { PageFootprint } from "../types.js";
import {
  DEFAULT_TREE_SETTINGS,
  generateTreeInstances,
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

function pageNode(mesh: PageMesh = pageMesh()): ClodPageNode {
  return {
    id: "L0:0,0",
    level: 0,
    children: [],
    mesh,
    footprint,
    bounds: { center: [16, 24, 16], radius: Math.hypot(32, 32) * 0.5 },
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

describe("tree placement", () => {
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

describe("TreeSystem", () => {
  it("uses double-sided far card materials and disables origin-based frustum culling", () => {
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
      expect(meshes.every((mesh) => mesh.frustumCulled === false)).toBe(true);

      const farMeshes = meshes.filter((mesh) => mesh.name.endsWith("-far"));
      expect(farMeshes).toHaveLength(TREE_SPECIES.length);
      for (const mesh of farMeshes) {
        const material = mesh.material as THREE.Material;
        expect(material.side).toBe(THREE.DoubleSide);
        expect(material.transparent).toBe(false);
      }
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
});
