import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  cloneTreeSettings,
  createTreeGeometryMap,
  disposeTreeGeometryMap,
  disposeTreeSystemBakedImpostorGeometries,
  disposeTreeSystemImpostorMaterials,
  octFrames,
  selectTreeSystemGeometry,
  selectTreeSystemMaterial,
  treeCanUseBakedImpostor,
  updateTreeSystemImpostorMaterial,
  type TreeImpostorAtlas,
  type TreeMaterialHandle,
} from "./index.js";

describe("tree system impostor resource helpers", () => {
  it("checks baked impostor readiness", () => {
    const settings = cloneTreeSettings();
    settings.impostors.enabled = true;
    expect(treeCanUseBakedImpostor(settings, {}, "oak")).toBe(false);
    expect(treeCanUseBakedImpostor(settings, { oak: fakeAtlas("oak", false) }, "oak")).toBe(false);
    expect(treeCanUseBakedImpostor(settings, { oak: fakeAtlas("oak", true) }, "oak")).toBe(true);
    settings.impostors.enabled = false;
    expect(treeCanUseBakedImpostor(settings, { oak: fakeAtlas("oak", true) }, "oak")).toBe(false);
  });

  it("selects normal geometry unless a baked impostor is ready", () => {
    const settings = cloneTreeSettings();
    settings.impostors.enabled = true;
    const geometries = createTreeGeometryMap(settings);
    const baked: Partial<Record<"oak" | "pine" | "dead", THREE.BufferGeometry>> = {};
    try {
      const near = selectTreeSystemGeometry({
        species: "oak",
        lod: "near",
        settings,
        geometries,
        impostorAtlases: { oak: fakeAtlas("oak") },
        bakedImpostorGeometries: baked,
      });
      expect(near).toBe(geometries.oak.near);

      const impostor = selectTreeSystemGeometry({
        species: "oak",
        lod: "impostor",
        settings,
        geometries,
        impostorAtlases: { oak: fakeAtlas("oak") },
        bakedImpostorGeometries: baked,
      });
      const cached = selectTreeSystemGeometry({
        species: "oak",
        lod: "impostor",
        settings,
        geometries,
        impostorAtlases: { oak: fakeAtlas("oak") },
        bakedImpostorGeometries: baked,
      });
      expect(impostor).not.toBe(geometries.oak.impostor);
      expect(cached).toBe(impostor);
      expect(baked.oak).toBe(impostor);
    } finally {
      disposeTreeSystemBakedImpostorGeometries(baked);
      disposeTreeGeometryMap(geometries);
    }
  });

  it("selects regular, debug, or baked impostor material", () => {
    const settings = cloneTreeSettings();
    settings.impostors.enabled = true;
    const regular = new THREE.MeshBasicMaterial();
    const debug = new THREE.MeshBasicMaterial();
    const impostor = new THREE.MeshBasicMaterial();
    const handle = fakeHandle(regular, debug);

    expect(selectTreeSystemMaterial({
      species: "oak",
      lod: "near",
      settings,
      materialHandle: handle,
      impostorAtlases: { oak: fakeAtlas("oak") },
      impostorMaterials: { oak: impostor },
    })).toBe(regular);

    expect(selectTreeSystemMaterial({
      species: "oak",
      lod: "impostor",
      settings,
      materialHandle: handle,
      impostorAtlases: { oak: fakeAtlas("oak") },
      impostorMaterials: { oak: impostor },
    })).toBe(impostor);

    settings.render.debugColorByLod = true;
    expect(selectTreeSystemMaterial({
      species: "oak",
      lod: "impostor",
      settings,
      materialHandle: handle,
      impostorAtlases: { oak: fakeAtlas("oak") },
      impostorMaterials: { oak: impostor },
    })).toBe(debug);
  });

  it("creates, reuses, updates, and disposes classic impostor materials", () => {
    const settings = cloneTreeSettings();
    const atlas = fakeAtlas("pine");
    const materials: Partial<Record<"oak" | "pine" | "dead", THREE.Material>> = {};
    const first = updateTreeSystemImpostorMaterial({
      species: "pine",
      settings,
      atlas,
      webgpu: false,
      impostorMaterials: materials,
    });
    const disposeSpy = vi.spyOn(first, "dispose");
    const second = updateTreeSystemImpostorMaterial({
      species: "pine",
      settings,
      atlas,
      webgpu: false,
      impostorMaterials: materials,
    });

    expect(second).toBe(first);
    expect(materials.pine).toBe(first);
    disposeTreeSystemImpostorMaterials(materials);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it("creates four-frame blend impostor material when requested", () => {
    const settings = cloneTreeSettings();
    const atlas = fakeAtlas("dead");
    const materials: Partial<Record<"oak" | "pine" | "dead", THREE.Material>> = {};
    const material = updateTreeSystemImpostorMaterial({
      species: "dead",
      settings,
      atlas,
      webgpu: false,
      viewBlend: true,
      impostorMaterials: materials,
    });

    expect(material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(material.name).toBe("tree-impostor-blend-dead");
    expect(materials.dead).toBe(material);
  });
});

function fakeHandle(regularMaterial: THREE.Material, debugMaterial: THREE.Material): TreeMaterialHandle {
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

function fakeAtlas(species: "oak" | "pine" | "dead", ready = true): TreeImpostorAtlas {
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
    ready,
    dispose() {
      texture.dispose();
    },
  };
}
