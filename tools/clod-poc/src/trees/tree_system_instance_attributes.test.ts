import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  cloneTreeSettings,
  octFrameIndexForDirection,
  octFrames,
  TREE_IMPOSTOR_BLEND_SAMPLE_COUNT,
  TREE_IMPOSTOR_BLEND_UV_ATTRIBUTE_NAMES,
  TREE_IMPOSTOR_BLEND_WEIGHT_ATTRIBUTE_NAME,
  TREE_IMPOSTOR_LOCAL_POSITION_SCALE_ATTRIBUTE_NAME,
  TREE_LOD_DITHER_SECONDARY,
  treeImpostorLocalPositionScaleAttribute,
  treeImpostorUvRectAttribute,
  treeLodDitherRoleAttribute,
  treeLodFadeAttribute,
  treeIdentityBitsAttribute,
  treeWorldXZAttribute,
  writeTreeImpostorLocalPositionScaleIfChanged,
  writeTreeImpostorUvRectIfChanged,
  writeTreeLodDitherRoleIfChanged,
  writeTreeLodFadeIfChanged,
  writeTreeIdentityIfChanged,
  writeTreeWorldXZIfChanged,
  writeUvRectIfChanged,
  type TreeImpostorAtlas,
  type TreeInstance,
} from "./index.js";

describe("tree system instance attribute writers", () => {
  it("writes world XZ only when values change", () => {
    const mesh = testMesh();
    expect(writeTreeWorldXZIfChanged(mesh, 1, 10, 20)).toBe(true);
    expect(writeTreeWorldXZIfChanged(mesh, 1, 10, 20)).toBe(false);
    const attribute = treeWorldXZAttribute(mesh);
    expect(attribute.getX(1)).toBe(10);
    expect(attribute.getY(1)).toBe(20);
  });

  it("preserves the full stable identity as bitcast instance data", () => {
    const mesh = testMesh();
    const identity = { stableIdLo: 0xfedc_ba98, stableIdHi: 0x8765_4321 };
    expect(writeTreeIdentityIfChanged(mesh, 1, identity)).toBe(true);
    expect(writeTreeIdentityIfChanged(mesh, 1, identity)).toBe(false);
    const attribute = treeIdentityBitsAttribute(mesh);
    const words = attribute.array as Uint32Array;
    expect(Array.from(words.slice(2, 4))).toEqual([identity.stableIdLo, identity.stableIdHi]);
  });

  it("writes impostor local position and scale only when values change", () => {
    const mesh = testMesh();
    expect(writeTreeImpostorLocalPositionScaleIfChanged(mesh, 1, 1, 2, 3, 4)).toBe(true);
    expect(writeTreeImpostorLocalPositionScaleIfChanged(mesh, 1, 1, 2, 3, 4)).toBe(false);
    const attribute = treeImpostorLocalPositionScaleAttribute(mesh);
    expect(attribute.getX(1)).toBe(1);
    expect(attribute.getY(1)).toBe(2);
    expect(attribute.getZ(1)).toBe(3);
    expect(attribute.getW(1)).toBe(4);
  });

  it("writes lod fade only when values change", () => {
    const mesh = testMesh();
    expect(writeTreeLodFadeIfChanged(mesh, 0, 0.5)).toBe(true);
    expect(writeTreeLodFadeIfChanged(mesh, 0, 0.5)).toBe(false);
    expect(treeLodFadeAttribute(mesh).getX(0)).toBe(0.5);
  });

  it("writes lod dither role only when values change", () => {
    const mesh = testMesh();
    expect(writeTreeLodDitherRoleIfChanged(mesh, 0, TREE_LOD_DITHER_SECONDARY)).toBe(true);
    expect(writeTreeLodDitherRoleIfChanged(mesh, 0, TREE_LOD_DITHER_SECONDARY)).toBe(false);
    expect(treeLodDitherRoleAttribute(mesh).getX(0)).toBe(TREE_LOD_DITHER_SECONDARY);
  });

  it("writes a raw UV rect only when values change", () => {
    const mesh = testMesh();
    const attribute = treeImpostorUvRectAttribute(mesh);
    expect(writeUvRectIfChanged(attribute, 0, 0.1, 0.2, 0.3, 0.4)).toBe(true);
    expect(writeUvRectIfChanged(attribute, 0, 0.1, 0.2, 0.3, 0.4)).toBe(false);
    expect(attribute.getX(0)).toBeCloseTo(0.1);
    expect(attribute.getY(0)).toBeCloseTo(0.2);
    expect(attribute.getZ(0)).toBeCloseTo(0.3);
    expect(attribute.getW(0)).toBeCloseTo(0.4);
  });

  it("falls back to full atlas rect when no atlas is ready", () => {
    const mesh = testMesh();
    const settings = cloneTreeSettings();
    const changed = writeTreeImpostorUvRectIfChanged({
      mesh,
      index: 0,
      instance: testInstance("oak"),
      cameraPosition: new THREE.Vector3(1, 2, 3),
      settings,
      impostorAtlases: {},
    });

    expect(changed).toBe(true);
    expectUvRect(mesh, 0, [0, 0, 1, 1]);
    expectBlendWeights(mesh, 0, [1, 0, 0, 0]);
  });

  it("falls back to full atlas rect when a ready atlas has no frames", () => {
    const mesh = testMesh();
    const settings = cloneTreeSettings();
    const atlas = { ...fakeAtlas("oak"), frames: [] };
    const changed = writeTreeImpostorUvRectIfChanged({
      mesh,
      index: 0,
      instance: testInstance("oak"),
      cameraPosition: new THREE.Vector3(1, 2, 3),
      settings,
      impostorAtlases: { oak: atlas },
    });

    expect(changed).toBe(true);
    expectUvRect(mesh, 0, [0, 0, 1, 1]);
    expectBlendWeights(mesh, 0, [1, 0, 0, 0]);
  });

  it("honors frozen impostor frame", () => {
    const mesh = testMesh();
    const settings = cloneTreeSettings();
    settings.impostors.debugFreezeFrame = 2;
    const atlas = fakeAtlas("pine");
    writeTreeImpostorUvRectIfChanged({
      mesh,
      index: 1,
      instance: testInstance("pine"),
      cameraPosition: new THREE.Vector3(10, 0, 10),
      settings,
      impostorAtlases: { pine: atlas },
    });

    const expected = atlas.frames[2];
    expectUvRect(mesh, 1, [expected.uvMin[0], expected.uvMin[1], expected.uvMax[0], expected.uvMax[1]]);
    expectBlendUvRect(mesh, 1, 0, [expected.uvMin[0], expected.uvMin[1], expected.uvMax[0], expected.uvMax[1]]);
    expectBlendWeights(mesh, 1, [1, 0, 0, 0]);
  });

  it("updates camera-selected impostor frame", () => {
    const mesh = testMesh();
    const settings = cloneTreeSettings();
    settings.impostors.debugFreezeFrame = -1;
    const atlas = fakeAtlas("dead");
    const instance = testInstance("dead");

    writeTreeImpostorUvRectIfChanged({
      mesh,
      index: 0,
      instance,
      cameraPosition: new THREE.Vector3(-100, 0, 0),
      settings,
      impostorAtlases: { dead: atlas },
    });
    const attribute = treeImpostorUvRectAttribute(mesh);
    const first = [attribute.getX(0), attribute.getY(0), attribute.getZ(0), attribute.getW(0)];

    writeTreeImpostorUvRectIfChanged({
      mesh,
      index: 0,
      instance,
      cameraPosition: new THREE.Vector3(100, 0, 0),
      settings,
      impostorAtlases: { dead: atlas },
    });
    const second = [attribute.getX(0), attribute.getY(0), attribute.getZ(0), attribute.getW(0)];
    expect(second).not.toEqual(first);
    const weights = mesh.geometry.getAttribute(TREE_IMPOSTOR_BLEND_WEIGHT_ATTRIBUTE_NAME);
    const actualWeights = [weights.getX(0), weights.getY(0), weights.getZ(0), weights.getW(0)];
    for (const weight of actualWeights) {
      expect(weight).toBeGreaterThanOrEqual(0);
      expect(weight).toBeLessThanOrEqual(1);
    }
    expect(actualWeights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 6);
  });

  it("selects CPU impostor atlas frames in tree-local yaw space", () => {
    const mesh = testMesh();
    const settings = cloneTreeSettings();
    settings.impostors.debugFreezeFrame = -1;
    const atlas = fakeAtlas("oak");
    const instance = {
      ...testInstance("oak"),
      rotationY: Math.PI * 0.5,
    };
    const expected = atlas.frames[octFrameIndexForDirection(new THREE.Vector3(0, 0, 100), atlas.gridSize)];

    writeTreeImpostorUvRectIfChanged({
      mesh,
      index: 0,
      instance,
      cameraPosition: new THREE.Vector3(100, 0, 0),
      settings,
      impostorAtlases: { oak: atlas },
    });

    expectUvRect(mesh, 0, [expected.uvMin[0], expected.uvMin[1], expected.uvMax[0], expected.uvMax[1]]);
  });

  it("selects CPU impostor UVs from the instance structural variant row", () => {
    const mesh = testMesh();
    const settings = cloneTreeSettings();
    settings.impostors.debugFreezeFrame = 0;
    const atlas = fakeAtlas("oak");
    const instance = { ...testInstance("oak"), variant: 1 };
    const expected = atlas.variantFrames?.[1]?.[0];
    expect(expected).toBeDefined();

    writeTreeImpostorUvRectIfChanged({
      mesh,
      index: 0,
      instance,
      cameraPosition: new THREE.Vector3(100, 0, 0),
      settings,
      impostorAtlases: { oak: atlas },
    });

    expectUvRect(mesh, 0, [expected!.uvMin[0], expected!.uvMin[1], expected!.uvMax[0], expected!.uvMax[1]]);
    expectBlendUvRect(mesh, 0, 0, [expected!.uvMin[0], expected!.uvMin[1], expected!.uvMax[0], expected!.uvMax[1]]);
  });
});

function expectUvRect(mesh: THREE.InstancedMesh, index: number, expected: [number, number, number, number]): void {
  const attribute = treeImpostorUvRectAttribute(mesh);
  expect(attribute.getX(index)).toBeCloseTo(expected[0]);
  expect(attribute.getY(index)).toBeCloseTo(expected[1]);
  expect(attribute.getZ(index)).toBeCloseTo(expected[2]);
  expect(attribute.getW(index)).toBeCloseTo(expected[3]);
}

function expectBlendUvRect(
  mesh: THREE.InstancedMesh,
  index: number,
  sampleIndex: number,
  expected: [number, number, number, number],
): void {
  const attribute = mesh.geometry.getAttribute(TREE_IMPOSTOR_BLEND_UV_ATTRIBUTE_NAMES[sampleIndex]);
  expect(attribute.getX(index)).toBeCloseTo(expected[0]);
  expect(attribute.getY(index)).toBeCloseTo(expected[1]);
  expect(attribute.getZ(index)).toBeCloseTo(expected[2]);
  expect(attribute.getW(index)).toBeCloseTo(expected[3]);
}

function expectBlendWeights(
  mesh: THREE.InstancedMesh,
  index: number,
  expected: [number, number, number, number],
): void {
  const attribute = mesh.geometry.getAttribute(TREE_IMPOSTOR_BLEND_WEIGHT_ATTRIBUTE_NAME);
  expect(attribute.getX(index)).toBeCloseTo(expected[0]);
  expect(attribute.getY(index)).toBeCloseTo(expected[1]);
  expect(attribute.getZ(index)).toBeCloseTo(expected[2]);
  expect(attribute.getW(index)).toBeCloseTo(expected[3]);
}

function testMesh(): THREE.InstancedMesh {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
  geometry.setAttribute("treeWorldXZ", new THREE.InstancedBufferAttribute(new Float32Array(4), 2));
  geometry.setAttribute("treeIdentityBits", new THREE.InstancedBufferAttribute(new Uint32Array(4), 2));
  geometry.setAttribute(TREE_IMPOSTOR_LOCAL_POSITION_SCALE_ATTRIBUTE_NAME, new THREE.InstancedBufferAttribute(new Float32Array(8), 4));
  geometry.setAttribute("treeLodFade", new THREE.InstancedBufferAttribute(new Float32Array(2).fill(1), 1));
  geometry.setAttribute("treeLodDitherRole", new THREE.InstancedBufferAttribute(new Float32Array(2), 1));
  geometry.setAttribute("treeImpostorUvRect", new THREE.InstancedBufferAttribute(new Float32Array(8), 4));
  for (const name of TREE_IMPOSTOR_BLEND_UV_ATTRIBUTE_NAMES) {
    geometry.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(8), 4));
  }
  const weights = new Float32Array(2 * TREE_IMPOSTOR_BLEND_SAMPLE_COUNT);
  weights[0] = 1;
  weights[TREE_IMPOSTOR_BLEND_SAMPLE_COUNT] = 1;
  geometry.setAttribute(
    TREE_IMPOSTOR_BLEND_WEIGHT_ATTRIBUTE_NAME,
    new THREE.InstancedBufferAttribute(weights, TREE_IMPOSTOR_BLEND_SAMPLE_COUNT),
  );
  return new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), 2);
}

function testInstance(species: "oak" | "pine" | "dead"): TreeInstance {
  return {
    position: [0, 0, 0],
    normalY: 1,
    species,
    variant: 0,
    scale: 1,
    rotationY: 0,
  } as TreeInstance;
}

function fakeAtlas(species: "oak" | "pine" | "dead"): TreeImpostorAtlas {
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const base = octFrames(4, 32, 1).map((frame) => ({
    ...frame,
    uvMin: [frame.uvMin[0], frame.uvMin[1] * 0.5] as [number, number],
    uvMax: [frame.uvMax[0], frame.uvMax[1] * 0.5] as [number, number],
  }));
  const variant = octFrames(4, 32, 1).map((frame) => ({
    ...frame,
    uvMin: [frame.uvMin[0], 0.5 + frame.uvMin[1] * 0.5] as [number, number],
    uvMax: [frame.uvMax[0], 0.5 + frame.uvMax[1] * 0.5] as [number, number],
  }));
  return {
    species,
    texture,
    albedo: texture,
    normalDepth: texture,
    gridSize: 4,
    resolutionPx: 32,
    atlasSizePx: 128,
    atlasWidthPx: 128,
    atlasHeightPx: 256,
    variantCount: 2,
    frames: base,
    variantFrames: { 0: base, 1: variant },
    ready: true,
    dispose() {
      texture.dispose();
    },
  };
}
