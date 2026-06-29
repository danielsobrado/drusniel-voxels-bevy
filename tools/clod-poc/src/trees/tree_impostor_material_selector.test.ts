import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  cloneTreeSettings,
  createSelectedTreeImpostorMaterial,
  type TreeImpostorAtlas,
} from "./index.js";

describe("tree impostor material selector", () => {
  it("selects classic shader material for non-WebGPU single-frame impostors", () => {
    const material = createSelectedTreeImpostorMaterial(cloneTreeSettings(), fakeAtlas(), {
      webgpu: false,
      viewBlend: false,
    });

    expect(material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(material.name).toBe("tree-impostor-oak");
  });

  it("selects classic shader material for non-WebGPU four-frame blend impostors", () => {
    const material = createSelectedTreeImpostorMaterial(cloneTreeSettings(), fakeAtlas(), {
      webgpu: false,
      viewBlend: true,
    });

    expect(material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(material.name).toBe("tree-impostor-blend-oak");
  });
});

function fakeAtlas(): TreeImpostorAtlas {
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  return {
    species: "oak",
    texture,
    albedo: texture,
    normalDepth: texture,
    gridSize: 8,
    resolutionPx: 128,
    atlasSizePx: 1024,
    frames: [],
    radius: 1,
    centerY: 0,
    ready: true,
    dispose() {
      texture.dispose();
    },
  };
}
