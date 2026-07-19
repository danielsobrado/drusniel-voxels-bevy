import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { cloneTreeSettings } from "./tree_config.js";
import { TreeSystem } from "./tree_system_runtime.js";

describe("tree system refresh update", () => {
  it("updates CPU patch LODs once when a refresh is required", () => {
    const settings = cloneTreeSettings();
    settings.gpu.enabled = false;
    const system = new TreeSystem({
      scene: new THREE.Scene(),
      nodes: [],
      worldCells: 32,
      settings,
    });

    try {
      system.markPatchesDirty();
      const updatePatchLods = vi.spyOn(system, "updatePatchLods");
      const center = new THREE.Vector3(16, 0, 16);
      const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
      camera.position.copy(center);

      system.update(0, center, camera);

      expect(updatePatchLods).toHaveBeenCalledTimes(1);
    } finally {
      system.dispose();
    }
  });
});
