import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  cloneTreeSettings,
  octFrames,
  treeImpostorUvRectAttribute,
  treeLodFadeAttribute,
  treeWorldXZAttribute,
  writeTreeImpostorUvRectIfChanged,
  writeTreeLodFadeIfChanged,
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

  it("writes lod fade only when values change", () => {
    const mesh = testMesh();
    expect(writeTreeLodFadeIfChanged(mesh, 0, 0.5)).toBe(true);
    expect(writeTreeLodFadeIfChanged(mesh, 0, 0.5)).toBe(false);
    expect(treeLodFadeAttribute(mesh).getX(0)).toBe(0.5);
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
    const attribute = treeImpostorUvRectAttribute(mesh);
    expect(attribute.getX(0)).toBe(0);
    expect(attribute.getY(0)).toBe(0);
    expect(attribute.getZ(0)).toBe(1);
    expect(attribute.getW(0)).toBe(1);
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
    const attribute = treeImpostorUvRectAttribute(mesh);
    expect(attribute.getX(1)).toBeCloseTo(expected.uvMin[0]);
    expect(attribute.getY(1)).toBeCloseTo(expected.uvMin[1]);
    expect(attribute.getZ(1)).toBeCloseTo(expected.uvMax[0]);
    expect(attribute.getW(1)).toBeCloseTo(expected.uvMax[1]);
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
  });
});

function testMesh(): THREE.InstancedMesh {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
  geometry.setAttribute("treeWorldXZ", new THREE.InstancedBufferAttribute(new Float32Array(4), 2));
  geometry.setAttribute("treeLodFade", new THREE.InstancedBufferAttribute(new Float32Array(2).fill(1), 1));
  geometry.setAttribute("treeImpostorUvRect", new THREE.InstancedBufferAttribute(new Float32Array(8), 4));
  return new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), 2);
}

function testInstance(species: "oak" | "pine" | "dead"): TreeInstance {
  return {
    position: [0, 0, 0],
    normalY: 1,
    species,
    scale: 1,
    rotationY: 0,
  } as TreeInstance;
}

function fakeAtlas(species: "oak" | "pine" | "dead"): TreeImpostorAtlas {
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
