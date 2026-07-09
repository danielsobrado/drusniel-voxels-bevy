import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  applyTreeSystemMaterials,
  createTreeSystemImpostorGeometryForCapacity,
  replaceTreeSystemImpostorGeometries,
  replaceTreeSystemImpostorGeometry,
} from "./tree_system_material_application.js";
import {
  cloneTreeSettings,
  createTreeGeometryMap,
  disposeTreeGeometryMap,
  octFrames,
  TREE_IMPOSTOR_LOCAL_POSITION_SCALE_ATTRIBUTE_NAME,
  TREE_LODS,
  TREE_SPECIES,
  type TreeLod,
  type TreeMaterialHandle,
  type TreeSpeciesId,
  type TreeSystemMeshGrid,
  type TreeImpostorAtlas,
} from "./index.js";

describe("tree system material application helpers", () => {
  it("applies regular materials and shadow policy to every mesh", () => {
    const settings = cloneTreeSettings();
    settings.lod.shadowsMaxLod = "mid";
    const regular = new THREE.MeshBasicMaterial();
    const debug = new THREE.MeshBasicMaterial();
    const handle = materialHandle(regular, debug);
    const patch = { meshes: meshGrid() };

    applyTreeSystemMaterials({
      patches: [patch],
      settings,
      materialHandle: handle,
      impostorAtlases: {},
      impostorMaterials: {},
    });

    for (const species of TREE_SPECIES) {
      expect(patch.meshes[species].near.material).toBe(regular);
      expect(patch.meshes[species].mid.material).toBe(regular);
      expect(patch.meshes[species].far.material).toBe(regular);
      expect(patch.meshes[species].impostor.material).toBe(regular);
      expect(patch.meshes[species].near.castShadow).toBe(true);
      expect(patch.meshes[species].mid.castShadow).toBe(true);
      expect(patch.meshes[species].far.castShadow).toBe(false);
      expect(patch.meshes[species].impostor.castShadow).toBe(false);
    }
  });

  it("prefers debug materials over baked impostor materials", () => {
    const settings = cloneTreeSettings();
    settings.render.debugColorByLod = true;
    settings.impostors.enabled = true;
    const regular = new THREE.MeshBasicMaterial();
    const debug = new THREE.MeshBasicMaterial();
    const impostor = new THREE.MeshBasicMaterial();
    const patch = { meshes: meshGrid() };

    applyTreeSystemMaterials({
      patches: [patch],
      settings,
      materialHandle: materialHandle(regular, debug),
      impostorAtlases: { oak: fakeAtlas("oak") },
      impostorMaterials: { oak: impostor },
    });

    expect(patch.meshes.oak.impostor.material).toBe(debug);
  });

  it("creates impostor geometry for a fixed capacity", () => {
    const source = new THREE.PlaneGeometry(1, 2);
    const geometry = createTreeSystemImpostorGeometryForCapacity(source, 3);

    expect(geometry).not.toBe(source);
    expect(geometry.getAttribute("position")).toBeDefined();
    expect(geometry.getAttribute("treeWorldXZ").count).toBe(3);
    expect(geometry.getAttribute("treeWorldXZ").itemSize).toBe(2);
    expect(geometry.getAttribute(TREE_IMPOSTOR_LOCAL_POSITION_SCALE_ATTRIBUTE_NAME).count).toBe(3);
    expect(geometry.getAttribute(TREE_IMPOSTOR_LOCAL_POSITION_SCALE_ATTRIBUTE_NAME).itemSize).toBe(4);
    expect(geometry.getAttribute("treeLodFade").count).toBe(3);
    expect(geometry.getAttribute("treeLodFade").getX(0)).toBe(1);
    expect(geometry.getAttribute("treeImpostorUvRect").count).toBe(3);
    expect(geometry.getAttribute("treeImpostorUvRect").itemSize).toBe(4);
    for (let sample = 0; sample < 4; sample++) {
      expect(geometry.getAttribute(`treeImpostorUvRect${sample}`).count).toBe(3);
      expect(geometry.getAttribute(`treeImpostorUvRect${sample}`).itemSize).toBe(4);
    }
    expect(geometry.getAttribute("treeImpostorBlendWeights").count).toBe(3);
    expect(geometry.getAttribute("treeImpostorBlendWeights").itemSize).toBe(4);
    expect(geometry.getAttribute("treeImpostorBlendWeights").getX(0)).toBe(1);
  });

  it("keeps four-frame blend attributes even when the legacy omit flag is false", () => {
    const source = new THREE.PlaneGeometry(1, 2);
    const geometry = createTreeSystemImpostorGeometryForCapacity(source, 3, false);

    expect(geometry.getAttribute("treeImpostorUvRect")).toBeDefined();
    expect(geometry.getAttribute(TREE_IMPOSTOR_LOCAL_POSITION_SCALE_ATTRIBUTE_NAME)).toBeDefined();
    expect(geometry.getAttribute("treeImpostorUvRect0")).toBeDefined();
    expect(geometry.getAttribute("treeImpostorUvRect1")).toBeDefined();
    expect(geometry.getAttribute("treeImpostorUvRect2")).toBeDefined();
    expect(geometry.getAttribute("treeImpostorUvRect3")).toBeDefined();
    expect(geometry.getAttribute("treeImpostorBlendWeights")).toBeDefined();
  });

  it("replaces one impostor mesh geometry and invalidates bounds state", () => {
    const source = new THREE.PlaneGeometry(1, 2);
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial(), 2);
    const oldGeometry = mesh.geometry;
    const oldDispose = vi.spyOn(oldGeometry, "dispose");
    const bounds = new WeakMap<THREE.InstancedMesh, unknown>();
    bounds.set(mesh, { hasBounds: true });

    replaceTreeSystemImpostorGeometry(mesh, source, true, bounds);

    expect(mesh.geometry).not.toBe(oldGeometry);
    expect(mesh.geometry.getAttribute("treeWorldXZ").count).toBe(2);
    expect(mesh.geometry.getAttribute(TREE_IMPOSTOR_LOCAL_POSITION_SCALE_ATTRIBUTE_NAME)).toBeDefined();
    expect(mesh.geometry.getAttribute("treeImpostorBlendWeights")).toBeDefined();
    expect(oldDispose).toHaveBeenCalledTimes(1);
    expect(bounds.has(mesh)).toBe(false);
  });

  it("replaces impostor geometries for every species in every patch", () => {
    const settings = cloneTreeSettings();
    settings.impostors.enabled = true;
    const geometries = createTreeGeometryMap(settings);
    const patch = { meshes: meshGrid() };
    const old = TREE_SPECIES.map((species) => patch.meshes[species].impostor.geometry);
    const disposals = old.map((geometry) => vi.spyOn(geometry, "dispose"));
    const bounds = new WeakMap<THREE.InstancedMesh, unknown>();
    for (const species of TREE_SPECIES) bounds.set(patch.meshes[species].impostor, { hasBounds: true });
    try {
      replaceTreeSystemImpostorGeometries({
        patches: [patch],
        settings,
        geometries,
        impostorAtlases: { oak: fakeAtlas("oak") },
        bakedImpostorGeometries: {},
        meshBoundsState: bounds,
      });

      for (const species of TREE_SPECIES) {
        expect(patch.meshes[species].impostor.geometry).not.toBe(old[TREE_SPECIES.indexOf(species)]);
        expect(patch.meshes[species].impostor.geometry.getAttribute("treeImpostorUvRect")).toBeDefined();
        expect(patch.meshes[species].impostor.geometry.getAttribute(TREE_IMPOSTOR_LOCAL_POSITION_SCALE_ATTRIBUTE_NAME)).toBeDefined();
        expect(patch.meshes[species].impostor.geometry.getAttribute("treeImpostorBlendWeights")).toBeDefined();
        expect(bounds.has(patch.meshes[species].impostor)).toBe(false);
      }
      for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
    } finally {
      disposeTreeGeometryMap(geometries);
    }
  });
});

function materialHandle(regularMaterial: THREE.Material, debugMaterial: THREE.Material): TreeMaterialHandle {
  return {
    regularMaterial,
    debugMaterials: {
      near: debugMaterial,
      mid: debugMaterial,
      far: debugMaterial,
      impostor: debugMaterial,
    },
    setTime() {},
    updateSettings() {},
    dispose() {},
  } as TreeMaterialHandle;
}

function meshGrid(): TreeSystemMeshGrid {
  const grid = {} as TreeSystemMeshGrid;
  for (const species of TREE_SPECIES) {
    grid[species] = {} as Record<TreeLod, THREE.InstancedMesh>;
    for (const lod of TREE_LODS) {
      grid[species][lod] = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial(),
        2,
      );
    }
  }
  return grid;
}

function fakeAtlas(species: TreeSpeciesId): TreeImpostorAtlas {
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  return {
    species,
    texture,
    albedo: texture,
    normalDepth: texture,
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
