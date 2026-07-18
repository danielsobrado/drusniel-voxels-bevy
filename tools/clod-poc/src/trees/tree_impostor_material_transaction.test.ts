import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { replaceTreeImpostorMaterialAfterCreate } from "./tree_system_impostor_resources.js";

describe("tree impostor material replacement", () => {
  it("keeps the current material live when replacement construction fails", () => {
    const current = new THREE.MeshBasicMaterial();
    const dispose = vi.spyOn(current, "dispose");
    const failure = new Error("replacement failed");

    expect(() => replaceTreeImpostorMaterialAfterCreate(current, () => {
      throw failure;
    })).toThrow(failure);
    expect(dispose).not.toHaveBeenCalled();
  });

  it("disposes the current material only after replacement construction succeeds", () => {
    const current = new THREE.MeshBasicMaterial();
    const next = new THREE.MeshBasicMaterial();
    const dispose = vi.spyOn(current, "dispose");

    expect(replaceTreeImpostorMaterialAfterCreate(current, () => next)).toBe(next);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
