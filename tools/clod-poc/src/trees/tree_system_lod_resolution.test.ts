import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { cloneTreeSettings, octFrames, type TreeImpostorAtlas } from "./index.js";
import { resolveTreeSystemLod } from "./tree_system_lod_resolution.js";

describe("tree system LOD resolution helper", () => {
  it("keeps non-impostor LODs unchanged", () => {
    const settings = cloneTreeSettings();
    expect(resolveTreeSystemLod({
      species: "oak",
      lod: "near",
      settings,
      impostorAtlases: {},
    })).toBe("near");
  });

  it("falls back from impostor to far when atlas is missing and placeholders are disabled", () => {
    const settings = cloneTreeSettings();
    settings.impostors.enabled = true;
    settings.impostors.fallbackToPlaceholder = false;
    expect(resolveTreeSystemLod({
      species: "oak",
      lod: "impostor",
      settings,
      impostorAtlases: {},
    })).toBe("far");
  });

  it("keeps impostor LOD when placeholder fallback is enabled", () => {
    const settings = cloneTreeSettings();
    settings.impostors.enabled = true;
    settings.impostors.fallbackToPlaceholder = true;
    expect(resolveTreeSystemLod({
      species: "oak",
      lod: "impostor",
      settings,
      impostorAtlases: {},
    })).toBe("impostor");
  });

  it("keeps impostor LOD when a baked atlas is ready", () => {
    const settings = cloneTreeSettings();
    settings.impostors.enabled = true;
    settings.impostors.fallbackToPlaceholder = false;
    expect(resolveTreeSystemLod({
      species: "pine",
      lod: "impostor",
      settings,
      impostorAtlases: { pine: atlas("pine", true) },
    })).toBe("impostor");
  });

  it("falls back to far when the atlas exists but is not ready", () => {
    const settings = cloneTreeSettings();
    settings.impostors.enabled = true;
    settings.impostors.fallbackToPlaceholder = false;
    expect(resolveTreeSystemLod({
      species: "dead",
      lod: "impostor",
      settings,
      impostorAtlases: { dead: atlas("dead", false) },
    })).toBe("far");
  });
});

function atlas(species: "oak" | "pine" | "dead", ready: boolean): TreeImpostorAtlas {
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
