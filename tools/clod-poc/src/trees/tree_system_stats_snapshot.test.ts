import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { cloneTreeSettings } from "./tree_config.js";
import { TreeSystem } from "./tree_system_runtime.js";

describe("tree system stats snapshot", () => {
  it("returns a clone without rebuilding the current snapshot", () => {
    const settings = cloneTreeSettings();
    settings.enabled = false;
    settings.gpu.enabled = false;
    const system = new TreeSystem({
      scene: new THREE.Scene(),
      nodes: [],
      worldCells: 32,
      settings,
    });

    try {
      const updateStats = vi.spyOn(system, "updateStats");
      const first = system.getStats();
      const second = system.getStats();

      expect(updateStats).not.toHaveBeenCalled();
      expect(second).not.toBe(first);
      expect(second).toEqual(first);

      first.totalTrees = 99;
      expect(system.getStats().totalTrees).not.toBe(99);
      expect(updateStats).not.toHaveBeenCalled();
    } finally {
      system.dispose();
    }
  });
});
