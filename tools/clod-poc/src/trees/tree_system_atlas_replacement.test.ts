import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { cloneTreeSettings, type TreeSpeciesId } from "./tree_config.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import { TreeSystemAssets } from "./tree_system_assets_runtime.js";

function settingsForTest() {
  const settings = cloneTreeSettings();
  settings.impostors.enabled = true;
  settings.impostors.bakeOnStart = true;
  return settings;
}

describe("tree impostor atlas replacement", () => {
  it("preserves the live generation when replacement material creation fails", () => {
    const currentAtlas = fakeAtlas("oak", true);
    const currentDispose = vi.spyOn(currentAtlas, "dispose");
    const assets = new TreeSystemAssets({
      settings: settingsForTest(),
      webgpu: false,
      impostorAtlases: { oak: currentAtlas },
    });
    const currentMaterial = assets.impostorMaterials.oak;
    const failingAtlas = failingTextureAtlas("pine");
    const failingDispose = vi.spyOn(failingAtlas, "dispose");

    expect(() => assets.setImpostorAtlases({ pine: failingAtlas })).toThrow("replacement atlas texture failure");

    expect(assets.impostorAtlases.oak).toBe(currentAtlas);
    expect(assets.impostorMaterials.oak).toBe(currentMaterial);
    expect(assets.impostorStatus).toBe("baked");
    expect(currentDispose).not.toHaveBeenCalled();
    expect(failingDispose).toHaveBeenCalledTimes(1);
    assets.dispose();
  });

  it("does not dispose atlas objects retained by the replacement set", () => {
    const sharedAtlas = fakeAtlas("oak", true);
    const sharedDispose = vi.spyOn(sharedAtlas, "dispose");
    const assets = new TreeSystemAssets({
      settings: settingsForTest(),
      webgpu: false,
      impostorAtlases: { oak: sharedAtlas },
    });
    const pineAtlas = fakeAtlas("pine", true);

    assets.setImpostorAtlases({ oak: sharedAtlas, pine: pineAtlas });

    expect(assets.impostorAtlases.oak).toBe(sharedAtlas);
    expect(sharedDispose).not.toHaveBeenCalled();
    assets.dispose();
  });

  it("disposes duplicate atlas identities once and clears stale baked status", () => {
    const sharedAtlas = fakeAtlas("oak", true);
    const sharedDispose = vi.spyOn(sharedAtlas, "dispose");
    const assets = new TreeSystemAssets({
      settings: settingsForTest(),
      webgpu: false,
      impostorAtlases: { oak: sharedAtlas, pine: sharedAtlas },
    });

    assets.setImpostorAtlases({});

    expect(sharedDispose).toHaveBeenCalledTimes(1);
    expect(assets.impostorStatus).toBe("pending");
    expect(assets.impostorReason).toBeNull();
    expect(assets.impostorAtlases).toEqual({});
    expect(assets.impostorMaterials).toEqual({});
    assets.dispose();
  });
});

function failingTextureAtlas(species: TreeSpeciesId): TreeImpostorAtlas {
  const atlas = fakeAtlas(species, true);
  return new Proxy(atlas, {
    get(target, property, receiver) {
      if (property === "albedo" || property === "texture") {
        throw new Error("replacement atlas texture failure");
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

function fakeAtlas(species: TreeSpeciesId, ready: boolean): TreeImpostorAtlas {
  const albedo = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const normalDepth = new THREE.DataTexture(new Uint8Array([128, 255, 128, 255]), 1, 1);
  return {
    species,
    texture: albedo,
    albedo,
    normalDepth,
    gridSize: 8,
    resolutionPx: 128,
    atlasSizePx: 1024,
    frames: [],
    ready,
    dispose() {
      albedo.dispose();
      normalDepth.dispose();
    },
  };
}
