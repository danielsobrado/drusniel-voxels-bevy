import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { cloneTreeSettings, type TreeInstance } from "./index.js";
import { composeTreeInstanceMatrix, treeInstanceRotationY } from "./tree_system_instance_transform.js";

describe("tree instance transform helpers", () => {
  it("uses stored rotation for normal LODs", () => {
    const settings = cloneTreeSettings();
    settings.impostors.axialBillboard = true;
    const instance = tree([1, 2, 3], 2, 0.75);

    expect(treeInstanceRotationY({
      instance,
      lod: "near",
      cameraPosition: new THREE.Vector3(10, 0, 10),
      settings,
    })).toBe(0.75);
  });

  it("faces impostor billboards toward the camera", () => {
    const settings = cloneTreeSettings();
    settings.impostors.axialBillboard = true;
    const instance = tree([0, 0, 0], 1, 0.25);

    expect(treeInstanceRotationY({
      instance,
      lod: "impostor",
      cameraPosition: new THREE.Vector3(10, 0, 0),
      settings,
    })).toBeCloseTo(Math.PI * 0.5);
  });

  it("composes translation, yaw, and uniform scale", () => {
    const settings = cloneTreeSettings();
    settings.impostors.axialBillboard = false;
    const matrix = composeTreeInstanceMatrix({
      instance: tree([1, 2, 3], 2, Math.PI * 0.5),
      lod: "mid",
      cameraPosition: new THREE.Vector3(),
      settings,
    });
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    matrix.decompose(position, rotation, scale);

    expect(position.toArray()).toEqual([1, 2, 3]);
    expect(scale.x).toBeCloseTo(2);
    expect(scale.y).toBeCloseTo(2);
    expect(scale.z).toBeCloseTo(2);
    expect(new THREE.Euler().setFromQuaternion(rotation).y).toBeCloseTo(Math.PI * 0.5);
  });
});

function tree(position: [number, number, number], scale: number, rotationY: number): TreeInstance {
  return {
    position,
    normalY: 1,
    species: "oak",
    scale,
    rotationY,
  } as TreeInstance;
}
