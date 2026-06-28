import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  encodeTreeImpostorAlbedo,
  encodeTreeImpostorNormalComponent,
  octFrames,
  type TreeImpostorAtlas,
} from "./index.js";
import {
  decodeAndLightTreeImpostorSample,
  treeImpostorRuntimeBlend,
} from "./tree_impostor_runtime.js";

describe("tree impostor runtime contract", () => {
  it("returns four atlas samples with normalized weights", () => {
    const blend = treeImpostorRuntimeBlend(fakeAtlas(), new THREE.Vector3(1, 1, 2));
    expect(blend.samples).toHaveLength(4);
    const total = blend.samples.reduce((sum, sample) => sum + sample.weight, 0);
    expect(total).toBeCloseTo(1, 6);
    for (const sample of blend.samples) {
      expect(sample.uvMin[0]).toBeGreaterThanOrEqual(0);
      expect(sample.uvMin[1]).toBeGreaterThanOrEqual(0);
      expect(sample.uvMax[0]).toBeLessThanOrEqual(1);
      expect(sample.uvMax[1]).toBeLessThanOrEqual(1);
    }
  });

  it("decodes albedo and applies deterministic sun/hemisphere lighting", () => {
    const lit = decodeAndLightTreeImpostorSample({
      albedoCoverage: [
        encodeTreeImpostorAlbedo(0.25),
        encodeTreeImpostorAlbedo(0.5),
        encodeTreeImpostorAlbedo(0.75),
        0.8,
      ],
      normalDepth: [
        encodeTreeImpostorNormalComponent(0),
        encodeTreeImpostorNormalComponent(1),
        encodeTreeImpostorNormalComponent(0),
        0.5,
      ],
      weight: 0.25,
    }, {
      sunDirection: new THREE.Vector3(0, 1, 0),
      sunColor: new THREE.Color(1, 1, 1),
      skyLight: new THREE.Color(0.5, 0.5, 0.5),
      groundLight: new THREE.Color(0.1, 0.1, 0.1),
      yawRadians: 0,
    });

    expect(lit[0]).toBeGreaterThan(0.25);
    expect(lit[1]).toBeGreaterThan(lit[0]);
    expect(lit[2]).toBeGreaterThan(lit[1]);
    expect(lit[3]).toBeCloseTo(0.2, 6);
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
    frames: octFrames(8, 128, 2),
    radius: 1,
    centerY: 0,
    ready: true,
    dispose() {
      texture.dispose();
    },
  };
}
