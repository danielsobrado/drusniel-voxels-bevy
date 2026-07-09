import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  encodeTreeImpostorAlbedo,
  encodeTreeImpostorNormalComponent,
  octFrames,
  type TreeImpostorAtlas,
} from "./index.js";
import {
  blendTreeImpostorPackedNormals,
  createTreeImpostorBlendAttributes,
  decodeAndLightTreeImpostorSample,
  TREE_IMPOSTOR_BLEND_SAMPLE_COUNT,
  TREE_IMPOSTOR_UV_RECT_STRIDE,
  treeImpostorRuntimeBlend,
  writeTreeImpostorBlendAttributes,
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

  it("selects variant-specific frame rows for runtime blends", () => {
    const atlas = fakeAtlas();
    const base = treeImpostorRuntimeBlend(atlas, new THREE.Vector3(1, 1, 2), 0);
    const variant = treeImpostorRuntimeBlend(atlas, new THREE.Vector3(1, 1, 2), 1);

    expect(variant.samples[0].uvMin[1]).toBeGreaterThan(base.samples[0].uvMin[1]);
    expect(variant.samples[0].uvMax[1]).toBeGreaterThan(base.samples[0].uvMax[1]);
    expect(variant.samples.reduce((sum, sample) => sum + sample.weight, 0)).toBeCloseTo(1, 6);
  });

  it("packs four uv rects and weights per impostor instance", () => {
    const attributes = createTreeImpostorBlendAttributes(2);
    const blend = treeImpostorRuntimeBlend(fakeAtlas(), new THREE.Vector3(1, 1, 2));
    writeTreeImpostorBlendAttributes(attributes, 1, blend);

    expect(attributes.uvRects).toHaveLength(2 * TREE_IMPOSTOR_BLEND_SAMPLE_COUNT * TREE_IMPOSTOR_UV_RECT_STRIDE);
    expect(attributes.weights).toHaveLength(2 * TREE_IMPOSTOR_BLEND_SAMPLE_COUNT);
    const instanceUvBase = TREE_IMPOSTOR_BLEND_SAMPLE_COUNT * TREE_IMPOSTOR_UV_RECT_STRIDE;
    const instanceWeightBase = TREE_IMPOSTOR_BLEND_SAMPLE_COUNT;
    expect(attributes.uvRects[0]).toBe(0);
    expect(attributes.weights[0]).toBe(0);
    for (let i = 0; i < TREE_IMPOSTOR_BLEND_SAMPLE_COUNT; i++) {
      const sample = blend.samples[i];
      const uvOffset = instanceUvBase + i * TREE_IMPOSTOR_UV_RECT_STRIDE;
      expect(attributes.uvRects[uvOffset]).toBeCloseTo(sample.uvMin[0]);
      expect(attributes.uvRects[uvOffset + 1]).toBeCloseTo(sample.uvMin[1]);
      expect(attributes.uvRects[uvOffset + 2]).toBeCloseTo(sample.uvMax[0]);
      expect(attributes.uvRects[uvOffset + 3]).toBeCloseTo(sample.uvMax[1]);
      expect(attributes.weights[instanceWeightBase + i]).toBeCloseTo(sample.weight);
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

  it("uses billboard-facing normal to stabilize impostor relighting", () => {
    const sample = {
      albedoCoverage: [
        encodeTreeImpostorAlbedo(0.5),
        encodeTreeImpostorAlbedo(0.5),
        encodeTreeImpostorAlbedo(0.5),
        1,
      ] as [number, number, number, number],
      normalDepth: [
        encodeTreeImpostorNormalComponent(0),
        encodeTreeImpostorNormalComponent(1),
        encodeTreeImpostorNormalComponent(0),
        0.5,
      ] as [number, number, number, number],
      weight: 1,
    };
    const baseLighting = {
      sunDirection: new THREE.Vector3(0, 0, 1),
      sunColor: new THREE.Color(1, 1, 1),
      skyLight: new THREE.Color(0.5, 0.5, 0.5),
      groundLight: new THREE.Color(0.1, 0.1, 0.1),
      yawRadians: 0,
    };

    const capturedOnly = decodeAndLightTreeImpostorSample(sample, baseLighting);
    const blended = decodeAndLightTreeImpostorSample(sample, {
      ...baseLighting,
      billboardNormal: new THREE.Vector3(0, 0, 1),
      normalDetailWeight: 0.35,
    });

    expect(blended[0]).toBeGreaterThan(capturedOnly[0]);
    expect(blended[1]).toBeGreaterThan(capturedOnly[1]);
    expect(blended[2]).toBeGreaterThan(capturedOnly[2]);
  });

  it("normalizes weighted normal blends after decoding packed samples", () => {
    const blended = blendTreeImpostorPackedNormals([
      {
        normalDepth: [
          encodeTreeImpostorNormalComponent(1),
          encodeTreeImpostorNormalComponent(0),
          encodeTreeImpostorNormalComponent(0),
          0,
        ],
        weight: 0.5,
      },
      {
        normalDepth: [
          encodeTreeImpostorNormalComponent(0),
          encodeTreeImpostorNormalComponent(1),
          encodeTreeImpostorNormalComponent(0),
          0,
        ],
        weight: 0.5,
      },
    ]);
    const length = Math.hypot(blended[0], blended[1], blended[2]);
    expect(length).toBeCloseTo(1, 6);
    expect(blended[0]).toBeGreaterThan(0.7);
    expect(blended[1]).toBeGreaterThan(0.7);
  });

  it("clamps relit impostor colors under direct sun", () => {
    const lit = decodeAndLightTreeImpostorSample({
      albedoCoverage: [1, 1, 1, 1],
      normalDepth: [
        encodeTreeImpostorNormalComponent(0),
        encodeTreeImpostorNormalComponent(1),
        encodeTreeImpostorNormalComponent(0),
        0.5,
      ],
      weight: 1,
    }, {
      sunDirection: new THREE.Vector3(0, 1, 0),
      sunColor: new THREE.Color(4, 4, 4),
      skyLight: new THREE.Color(1, 1, 1),
      groundLight: new THREE.Color(1, 1, 1),
      yawRadians: 0,
    });

    expect(lit[0]).toBeLessThanOrEqual(1);
    expect(lit[1]).toBeLessThanOrEqual(1);
    expect(lit[2]).toBeLessThanOrEqual(1);
  });
});

function fakeAtlas(): TreeImpostorAtlas {
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const base = octFrames(8, 128, 2).map((frame) => ({
    ...frame,
    uvMin: [frame.uvMin[0], frame.uvMin[1] * 0.5] as [number, number],
    uvMax: [frame.uvMax[0], frame.uvMax[1] * 0.5] as [number, number],
  }));
  const variant = octFrames(8, 128, 2).map((frame) => ({
    ...frame,
    uvMin: [frame.uvMin[0], 0.5 + frame.uvMin[1] * 0.5] as [number, number],
    uvMax: [frame.uvMax[0], 0.5 + frame.uvMax[1] * 0.5] as [number, number],
  }));
  return {
    species: "oak",
    texture,
    albedo: texture,
    normalDepth: texture,
    gridSize: 8,
    resolutionPx: 128,
    atlasSizePx: 1024,
    atlasWidthPx: 1024,
    atlasHeightPx: 2048,
    variantCount: 2,
    frames: base,
    variantFrames: { 0: base, 1: variant },
    radius: 1,
    centerY: 0,
    ready: true,
    dispose() {
      texture.dispose();
    },
  };
}
