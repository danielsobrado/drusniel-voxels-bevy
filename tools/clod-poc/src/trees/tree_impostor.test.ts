import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { ClodPageNode, PageMesh } from "../types.js";
import type { PageFootprint } from "../types.js";
import {
  cloneTreeSettings,
  DEFAULT_TREE_IMPOSTOR_SETTINGS,
  DEFAULT_TREE_SETTINGS,
  createTreeImpostorMaterial,
  octDecode,
  octEncode,
  octFrameForIndex,
  octFrameIndexForDirection,
  octFrames,
  parseTreeConfig,
  TREE_IMPOSTOR_FRAGMENT_SHADER,
  TREE_IMPOSTOR_VERTEX_SHADER,
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
  species: {
    oak: { ...DEFAULT_TREE_SETTINGS.species.oak, minHeightM: 0, maxHeightM: 80 },
    pine: { ...DEFAULT_TREE_SETTINGS.species.pine, minHeightM: 0, maxHeightM: 80 },
    dead: { ...DEFAULT_TREE_SETTINGS.species.dead, minHeightM: 0, maxHeightM: 80 },
  },
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

  it("deep-clones impostor settings", () => {
    const cloned = cloneTreeSettings();
    expect(cloned.impostors).not.toBe(DEFAULT_TREE_SETTINGS.impostors);
    cloned.impostors.enabled = false;
    expect(DEFAULT_TREE_SETTINGS.impostors.enabled).toBe(true);
  });
});

describe("tree impostor octahedral math", () => {
  it("roundtrips representative directions", () => {
    const directions = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(1, 1, 1).normalize(),
    ];
    for (const direction of directions) {
      const decoded = octDecode(octEncode(direction));
      expect(decoded.dot(direction)).toBeGreaterThan(0.99);
    }
  });

  it("keeps frame indices and UV rects in range", () => {
    const index = octFrameIndexForDirection(new THREE.Vector3(1, 2, 3), 4);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(16);
    const padded = octFrameForIndex(index, 4, 128, 2);
    const unpadded = octFrameForIndex(index, 4, 128, 0);
    expect(padded.uvMin[0]).toBeGreaterThanOrEqual(0);
    expect(padded.uvMin[1]).toBeGreaterThanOrEqual(0);
    expect(padded.uvMax[0]).toBeLessThanOrEqual(1);
    expect(padded.uvMax[1]).toBeLessThanOrEqual(1);
    expect(padded.uvMin[0]).toBeGreaterThan(unpadded.uvMin[0]);
    expect(padded.uvMax[0]).toBeLessThan(unpadded.uvMax[0]);
  });

  it("returns finite normalized directions for every frame", () => {
    for (const frame of octFrames(4, 128, 2)) {
      const direction = new THREE.Vector3(frame.direction[0], frame.direction[1], frame.direction[2]);
      expect(Number.isFinite(direction.x)).toBe(true);
      expect(Number.isFinite(direction.y)).toBe(true);
      expect(Number.isFinite(direction.z)).toBe(true);
      expect(direction.length()).toBeCloseTo(1);
    }
  });
});

describe("tree impostor material", () => {
  it("uses alpha-tested double-sided shader sampling atlas UV rects", () => {
    const material = createTreeImpostorMaterial(settings, fakeAtlas("oak"));
    try {
      expect(material.side).toBe(THREE.DoubleSide);
      expect(material.transparent).toBe(false);
      expect(material.depthWrite).toBe(true);
      expect(TREE_IMPOSTOR_VERTEX_SHADER).toContain("treeImpostorUvRect");
      expect(TREE_IMPOSTOR_FRAGMENT_SHADER).toContain("texture2D(map");
      expect(TREE_IMPOSTOR_FRAGMENT_SHADER).toContain("discard");
    } finally {
      material.dispose();
    }
  });
});

describe("TreeSystem baked impostors", () => {
  it("adds impostor UV rect attributes and honors debug_freeze_frame", () => {
    const scene = new THREE.Scene();
    const atlas = fakeAtlas("oak");
    const frozenSettings: TreeSettings = {
      ...settings,
      impostors: { ...settings.impostors, debugFreezeFrame: 2 },
    };
    const system = new TreeSystem({
      scene,
      nodes: [pageNode()],
      worldCells: 32,
      settings: frozenSettings,
      sampler,
      impostorAtlases: { oak: atlas },
    });
    try {
      system.update(0, new THREE.Vector3(-105, 0, 16), cameraAt(new THREE.Vector3(-105, 0, 16)));
      const mesh = impostorMesh(scene, "oak");
      const uvRect = mesh.geometry.getAttribute("treeImpostorUvRect");
      expect(uvRect).toBeDefined();
      expect(uvRect.itemSize).toBe(4);
      expect(mesh.geometry.getAttribute("treeWorldXZ")).toBeDefined();
      expect(mesh.count).toBeGreaterThan(0);
      const expected = atlas.frames[2];
      expect(uvRect.getX(0)).toBeCloseTo(expected.uvMin[0]);
      expect(uvRect.getY(0)).toBeCloseTo(expected.uvMin[1]);
      expect(uvRect.getZ(0)).toBeCloseTo(expected.uvMax[0]);
      expect(uvRect.getW(0)).toBeCloseTo(expected.uvMax[1]);
    } finally {
      system.dispose();
    }
  });

  it("updates impostor frame selection when camera direction changes", () => {
    const scene = new THREE.Scene();
    const system = new TreeSystem({
      scene,
      nodes: [pageNode()],
      worldCells: 32,
      settings,
      sampler,
      impostorAtlases: { oak: fakeAtlas("oak") },
    });
    try {
      system.update(0, new THREE.Vector3(-105, 0, 16), cameraAt(new THREE.Vector3(-105, 0, 16)));
      const mesh = impostorMesh(scene, "oak");
      const uvRect = mesh.geometry.getAttribute("treeImpostorUvRect");
      const first = [uvRect.getX(0), uvRect.getY(0), uvRect.getZ(0), uvRect.getW(0)];
      system.update(0, new THREE.Vector3(-105, 0, 16), cameraAt(new THREE.Vector3(220, 0, 16)));
      const second = [uvRect.getX(0), uvRect.getY(0), uvRect.getZ(0), uvRect.getW(0)];
      expect(second).not.toEqual(first);
    } finally {
      system.dispose();
    }
  });

  it("keeps placeholder fallback working without an atlas", () => {
    const scene = new THREE.Scene();
    const system = new TreeSystem({
      scene,
      nodes: [pageNode()],
      worldCells: 32,
      settings: {
        ...settings,
        impostors: { ...settings.impostors, enabled: true, fallbackToPlaceholder: true },
      },
      sampler,
    });
    try {
      system.update(0, new THREE.Vector3(-105, 0, 16), cameraAt(new THREE.Vector3(-105, 0, 16)));
      const stats = system.getStats();
      expect(stats.impostorTrees).toBeGreaterThan(0);
      expect(impostorMesh(scene).geometry.getAttribute("treeImpostorUvRect")).toBeDefined();
    } finally {
      system.dispose();
    }
  });
});

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

function pageNode(): ClodPageNode {
  return {
    id: "L0:0,0",
    level: 0,
    children: [],
    mesh: pageMesh(),
    footprint,
    bounds: { center: [16, 24, 16], radius: Math.hypot(32, 32) * 0.5, minY: 0, maxY: 0 },
    errorWorld: 0,
    lowBenefit: false,
  };
}

function fakeAtlas(species: "oak" | "pine" | "dead"): TreeImpostorAtlas {
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  texture.needsUpdate = true;
  return {
    species,
    texture,
    gridSize: 4,
    resolutionPx: 32,
    atlasSizePx: 128,
    frames: octFrames(4, 32, 1),
    ready: true,
    dispose() {
      texture.dispose();
    },
  };
}

function impostorMesh(scene: THREE.Scene, species?: string): THREE.InstancedMesh {
  const meshes: THREE.InstancedMesh[] = [];
  scene.traverse((object) => {
    if ((object as THREE.InstancedMesh).isInstancedMesh) meshes.push(object as THREE.InstancedMesh);
  });
  const mesh = meshes.find((candidate) =>
    candidate.name.endsWith(`${species ? `-${species}` : ""}-impostor`) && candidate.count > 0,
  ) ?? meshes.find((candidate) => candidate.name.endsWith("-impostor"));
  expect(mesh).toBeDefined();
  return mesh!;
}
