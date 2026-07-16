import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  cloneTreeSettings,
  createTreeGpuRingBakedImpostorGeometry,
  mapTreeGpuRingBakedImpostorUvToFrame,
  octFrames,
  selectTreeGpuRingGeometry,
  TREE_SPECIES,
  type TreeGeometryMap,
  type TreeImpostorAtlas,
} from "./index.js";

describe("GPU ring tree geometry selector", () => {
  it("uses normal geometry for non-impostor LODs", () => {
    const geometries = geometryMap();
    const result = selectTreeGpuRingGeometry({
      species: "oak",
      lod: "far",
      geometries,
      settings: cloneTreeSettings(),
      impostorAtlases: {},
      bakedImpostorGeometries: {},
    });

    expect(result.bakedImpostor).toBe(false);
    expect(result.geometry).toBe(geometries.oak.far);
  });

  it("keeps far geometry visible until the baked atlas is ready", () => {
    const geometries = geometryMap();
    const settings = cloneTreeSettings();
    settings.impostors.enabled = true;
    settings.impostors.fallbackToPlaceholder = false;
    const result = selectTreeGpuRingGeometry({
      species: "pine",
      lod: "impostor",
      geometries,
      settings,
      impostorAtlases: { pine: { ...fakeAtlas("pine"), ready: false } },
      bakedImpostorGeometries: {},
    });

    expect(result.bakedImpostor).toBe(false);
    expect(result.geometry).toBe(geometries.pine.far);
  });

  it("uses placeholder geometry only when explicitly configured", () => {
    const geometries = geometryMap();
    const settings = cloneTreeSettings();
    settings.impostors.enabled = true;
    settings.impostors.fallbackToPlaceholder = true;
    const result = selectTreeGpuRingGeometry({
      species: "pine",
      lod: "impostor",
      geometries,
      settings,
      impostorAtlases: {},
      bakedImpostorGeometries: {},
    });

    expect(result.bakedImpostor).toBe(false);
    expect(result.geometry).toBe(geometries.pine.impostor);
  });

  it("does not draw GPU ring impostors when impostors are disabled", () => {
    const geometries = geometryMap();
    const settings = cloneTreeSettings();
    settings.impostors.enabled = false;
    const result = selectTreeGpuRingGeometry({
      species: "oak",
      lod: "impostor",
      geometries,
      settings,
      impostorAtlases: { oak: fakeAtlas("oak") },
      bakedImpostorGeometries: {},
    });

    expect(result.bakedImpostor).toBe(false);
    expect(result.geometry).not.toBe(geometries.oak.far);
    expect(result.geometry.getAttribute("position")).toBeUndefined();
  });

  it("uses and caches baked billboard geometry when the species atlas is ready", () => {
    const geometries = geometryMap();
    const settings = cloneTreeSettings();
    settings.impostors.enabled = true;
    const bakedImpostorGeometries: Partial<Record<(typeof TREE_SPECIES)[number], THREE.BufferGeometry>> = {};
    const atlas = fakeAtlas("dead", 4, 6);

    const first = selectTreeGpuRingGeometry({
      species: "dead",
      lod: "impostor",
      geometries,
      settings,
      impostorAtlases: { dead: atlas },
      bakedImpostorGeometries,
    });
    const second = selectTreeGpuRingGeometry({
      species: "dead",
      lod: "impostor",
      geometries,
      settings,
      impostorAtlases: { dead: atlas },
      bakedImpostorGeometries,
    });

    expect(first.bakedImpostor).toBe(true);
    expect(first.geometry).not.toBe(geometries.dead.impostor);
    expect(second.geometry).toBe(first.geometry);
    expect(bakedImpostorGeometries.dead).toBe(first.geometry);
    expect(first.geometry.getAttribute("uv")).toBeDefined();
    expect(first.geometry.getAttribute("treeVariant")).toBeDefined();
    expectPositionExtents(first.geometry, { minX: -4, maxX: 4, minY: 2, maxY: 10, maxAbsZ: 0 });
  });

  it("keeps baked billboard UVs local so the ring material can select atlas frames", () => {
    const settings = cloneTreeSettings();
    settings.impostors.enabled = true;
    const geometry = createTreeGpuRingBakedImpostorGeometry("oak", settings, fakeAtlas("oak"));
    const uv = geometry.getAttribute("uv");

    for (let index = 0; index < uv.count; index++) {
      expect(uv.getX(index)).toBeGreaterThanOrEqual(0);
      expect(uv.getX(index)).toBeLessThanOrEqual(1);
      expect(uv.getY(index)).toBeGreaterThanOrEqual(0);
      expect(uv.getY(index)).toBeLessThanOrEqual(1);
    }
  });

  it("remaps arbitrary geometry UVs into a frame rect", () => {
    const geometry = new THREE.PlaneGeometry(1, 1);
    mapTreeGpuRingBakedImpostorUvToFrame(geometry, {
      uvMin: [0.25, 0.5],
      uvMax: [0.5, 0.75],
    });
    const uv = geometry.getAttribute("uv");
    const values = Array.from({ length: uv.count }, (_, index) => [uv.getX(index), uv.getY(index)]);

    expect(values).toEqual(expect.arrayContaining([
      [0.25, 0.75],
      [0.5, 0.75],
      [0.25, 0.5],
      [0.5, 0.5],
    ]));
  });
});

function expectPositionExtents(
  geometry: THREE.BufferGeometry,
  expected: { minX: number; maxX: number; minY: number; maxY: number; maxAbsZ: number },
): void {
  const position = geometry.getAttribute("position");
  const xs = Array.from({ length: position.count }, (_, index) => position.getX(index));
  const ys = Array.from({ length: position.count }, (_, index) => position.getY(index));
  const zs = Array.from({ length: position.count }, (_, index) => Math.abs(position.getZ(index)));
  expect(Math.min(...xs)).toBeCloseTo(expected.minX);
  expect(Math.max(...xs)).toBeCloseTo(expected.maxX);
  expect(Math.min(...ys)).toBeCloseTo(expected.minY);
  expect(Math.max(...ys)).toBeCloseTo(expected.maxY);
  expect(Math.max(...zs)).toBeCloseTo(expected.maxAbsZ);
}

function geometryMap(): TreeGeometryMap {
  const out = {} as TreeGeometryMap;
  for (const species of TREE_SPECIES) {
    const near = new THREE.BoxGeometry(1, 3, 1);
    const mid = new THREE.BoxGeometry(1, 2, 1);
    const far = new THREE.BoxGeometry(1, 1, 1);
    const impostor = new THREE.PlaneGeometry(1, 2);
    out[species] = {
      near,
      mid,
      far,
      impostor,
      variants: { 0: { near, mid, far, impostor } },
    };
  }
  return out;
}

function fakeAtlas(species: (typeof TREE_SPECIES)[number], radius = 1, centerY = 0): TreeImpostorAtlas {
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  texture.needsUpdate = true;
  return {
    species,
    texture,
    albedo: texture,
    normalDepth: texture,
    gridSize: 8,
    resolutionPx: 128,
    atlasSizePx: 1024,
    frames: octFrames(8, 128, 2),
    radius,
    centerY,
    ready: true,
    dispose() {
      texture.dispose();
    },
  };
}
