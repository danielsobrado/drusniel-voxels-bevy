import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  cloneTreeSettings,
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

  it("falls back to procedural impostor geometry when no atlas is ready", () => {
    const geometries = geometryMap();
    const settings = cloneTreeSettings();
    settings.impostors.enabled = true;
    const result = selectTreeGpuRingGeometry({
      species: "pine",
      lod: "impostor",
      geometries,
      settings,
      impostorAtlases: { pine: { ...fakeAtlas("pine"), ready: false } },
      bakedImpostorGeometries: {},
    });

    expect(result.bakedImpostor).toBe(false);
    expect(result.geometry).toBe(geometries.pine.impostor);
  });

  it("falls back to procedural impostor geometry when impostors are disabled", () => {
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
    expect(result.geometry).toBe(geometries.oak.impostor);
  });

  it("uses and caches baked billboard geometry when the species atlas is ready", () => {
    const geometries = geometryMap();
    const settings = cloneTreeSettings();
    settings.impostors.enabled = true;
    const bakedImpostorGeometries: Partial<Record<(typeof TREE_SPECIES)[number], THREE.BufferGeometry>> = {};

    const first = selectTreeGpuRingGeometry({
      species: "dead",
      lod: "impostor",
      geometries,
      settings,
      impostorAtlases: { dead: fakeAtlas("dead") },
      bakedImpostorGeometries,
    });
    const second = selectTreeGpuRingGeometry({
      species: "dead",
      lod: "impostor",
      geometries,
      settings,
      impostorAtlases: { dead: fakeAtlas("dead") },
      bakedImpostorGeometries,
    });

    expect(first.bakedImpostor).toBe(true);
    expect(first.geometry).not.toBe(geometries.dead.impostor);
    expect(second.geometry).toBe(first.geometry);
    expect(bakedImpostorGeometries.dead).toBe(first.geometry);
    expect(first.geometry.getAttribute("treeImpostorUvRect")).toBeDefined();
    expect(first.geometry.getAttribute("treeVariant")).toBeDefined();
  });
});

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

function fakeAtlas(species: (typeof TREE_SPECIES)[number]): TreeImpostorAtlas {
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
    radius: 1,
    centerY: 0,
    ready: true,
    dispose() {
      texture.dispose();
    },
  };
}
