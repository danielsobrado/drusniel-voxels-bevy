import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { cloneTreeSettings } from "./tree_config_defaults.js";
import { TREE_LODS, type TreeSpeciesId } from "./tree_config.js";
import type { TreeGeometryMap } from "./tree_geometry.js";
import { configureTreeImpostorAtlasTexture } from "./tree_impostor_baker.js";
import { selectTreeGpuRingGeometry } from "./tree_gpu_ring_geometry.js";
import { selectTreeSystemGeometry } from "./tree_system_impostor_resources.js";
import { estimateTreeImpostorAtlasMemoryMiB } from "./tree_impostor_memory.js";

const TEST_SPECIES: TreeSpeciesId = "oak";

function geometries(): TreeGeometryMap {
  const near = new THREE.BufferGeometry();
  const mid = new THREE.BufferGeometry();
  const far = new THREE.BufferGeometry();
  const impostor = new THREE.BufferGeometry();
  return {
    [TEST_SPECIES]: {
      near,
      mid,
      far,
      impostor,
      variants: {},
    },
  } as unknown as TreeGeometryMap;
}

describe("tree impostor quality defaults", () => {
  it("uses configured baked impostor defaults", () => {
    const settings = cloneTreeSettings();

    expect(settings.impostors.sourceLod).toBe("mid");
    expect(settings.impostors.resolutionPx).toBe(64);
    expect(settings.impostors.alphaTest).toBe(0.38);
    expect(settings.impostors.fallbackToPlaceholder).toBe(false);
    expect(settings.impostors.swapOnBake).toBe(true);
  });

  it("configures atlas textures for stable distant sampling", () => {
    const texture = new THREE.Texture();

    configureTreeImpostorAtlasTexture(texture);

    expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
    expect(texture.generateMipmaps).toBe(false);
    expect(texture.minFilter).toBe(THREE.LinearFilter);
    expect(texture.magFilter).toBe(THREE.LinearFilter);
    expect(texture.anisotropy).toBeGreaterThanOrEqual(4);
  });

  it("keeps the balanced 12-layer two-channel fallback within 144 MiB", () => {
    expect(estimateTreeImpostorAtlasMemoryMiB(cloneTreeSettings())).toBe(144);
  });

  it("uses placeholder impostor geometry while baked impostor atlases are not ready", () => {
    const settings = cloneTreeSettings();
    const map = geometries();

    for (const lod of TREE_LODS) {
      const geometry = selectTreeSystemGeometry({
        species: TEST_SPECIES,
        lod,
        settings,
        geometries: map,
        impostorAtlases: {},
        bakedImpostorGeometries: {},
      });

      expect(geometry).toBe(map[TEST_SPECIES][lod]);
    }
  });

  it("keeps placeholder impostors available when explicitly requested", () => {
    const settings = cloneTreeSettings();
    settings.impostors.fallbackToPlaceholder = true;
    const map = geometries();

    const geometry = selectTreeGpuRingGeometry({
      species: TEST_SPECIES,
      lod: "impostor",
      settings,
      geometries: map,
      impostorAtlases: {},
      bakedImpostorGeometries: {},
    });

    expect(geometry.geometry).toBe(map[TEST_SPECIES].impostor);
    expect(geometry.bakedImpostor).toBe(false);
  });
});
