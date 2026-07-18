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
    expect(settings.impostors.bakeAgeLayers).toBe(false);
    expect(settings.impostors.resolutionPx).toBe(128);
    expect(settings.impostors.atlasPaddingPx).toBe(4);
    expect(settings.impostors.alphaTest).toBe(0.32);
    expect(settings.impostors.fallbackToPlaceholder).toBe(false);
    expect(settings.impostors.swapOnBake).toBe(true);
  });

  it("configures atlas textures for stable distant sampling", () => {
    const texture = new THREE.Texture();

    configureTreeImpostorAtlasTexture(texture);

    expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
    expect(texture.generateMipmaps).toBe(true);
    expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(texture.magFilter).toBe(THREE.LinearFilter);
    expect(texture.anisotropy).toBeGreaterThanOrEqual(8);
  });

  it("keeps the balanced four-page mipmapped fallback within 256 MiB", () => {
    expect(estimateTreeImpostorAtlasMemoryMiB(cloneTreeSettings())).toBe(256);
  });

  it("uses the configured unbaked impostor fallback while baked atlases are not ready", () => {
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

      expect(geometry).toBe(map[TEST_SPECIES][lod === "impostor" ? "far" : lod]);
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
