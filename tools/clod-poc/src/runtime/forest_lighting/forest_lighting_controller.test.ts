import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { cloneForestLightingSettings } from "../../forest_lighting/index.js";
import { createForestLightingController, type ForestLightingControllerUiState } from "./forest_lighting_controller.js";

function uiState(): ForestLightingControllerUiState {
  return {
    forestLightingEnabled: true,
    forestLightingAoStrength: 0.32,
    forestLightingShadowStrength: 0.28,
    forestLightingFogStrength: 0.22,
    forestLightingSunShaftsStrength: 0.18,
    forestLightingDebugMode: "off",
  };
}

function makeController(readyAfterCalls: number, understoryReadyAfterCalls = 0) {
  const proxies = [{ x: 8, z: 8, height: 10, scale: 1, crownRadius: 4, species: "oak" }];
  let calls = 0;
  const treeSystem = {
    updateForestLighting: vi.fn(),
    getLightingProxiesBudgeted: vi.fn(() => {
      calls++;
      return calls > readyAfterCalls
        ? { proxies, ready: true }
        : { proxies: [], ready: false };
    }),
  };
  let understoryCalls = 0;
  const understorySystem = {
    updateForestLighting: vi.fn(),
    getLightingProxiesBudgeted: vi.fn(() => {
      understoryCalls++;
      return understoryCalls > understoryReadyAfterCalls
        ? { proxies: [{ x: 6, z: 6, classId: "shrub", scale: 1, densityWeight: 0.5 }], ready: true }
        : { proxies: [], ready: false };
    }),
  };
  const config = cloneForestLightingSettings();
  config.field.resolution = 8;
  config.field.maxBuildMsPerFrame = 1000;
  const controller = createForestLightingController({
    worldCells: 32,
    forestLightingConfig: config,
    getUiState: uiState,
    getTreeSystem: () => treeSystem as never,
    getUnderstorySystem: () => understorySystem as never,
    syncStatsToState: () => {},
  });
  return { controller, treeSystem, understorySystem };
}

describe("forest lighting controller budgeted update", () => {
  it("waits for budgeted tree proxies, then rebuilds and reports completion once", () => {
    const { controller, treeSystem, understorySystem } = makeController(2);
    const center = new THREE.Vector3(16, 0, 16);
    const sun = new THREE.Vector3(0.4, -0.8, 0.2).normalize();

    expect(controller.updateBudgeted(center, sun)).toBe(false);
    expect(controller.updateBudgeted(center, sun)).toBe(false);
    expect(understorySystem.getLightingProxiesBudgeted).not.toHaveBeenCalled();

    expect(controller.updateBudgeted(center, sun)).toBe(true);
    expect(understorySystem.getLightingProxiesBudgeted).toHaveBeenCalledTimes(1);
    expect(controller.system.getStats().treeProxies).toBe(1);
    expect(controller.system.getStats().understoryProxies).toBe(1);

    expect(controller.updateBudgeted(center, sun)).toBe(false);
    expect(treeSystem.getLightingProxiesBudgeted).toHaveBeenCalledTimes(3);
    controller.dispose();
  });

  it("waits for budgeted understory proxies before starting the rebuild", () => {
    const { controller, understorySystem } = makeController(0, 2);
    const center = new THREE.Vector3(16, 0, 16);
    const sun = new THREE.Vector3(0.4, -0.8, 0.2).normalize();

    expect(controller.updateBudgeted(center, sun)).toBe(false);
    expect(controller.updateBudgeted(center, sun)).toBe(false);
    expect(controller.system.hasBuildInProgress()).toBe(false);

    expect(controller.updateBudgeted(center, sun)).toBe(true);
    expect(understorySystem.getLightingProxiesBudgeted).toHaveBeenCalledTimes(3);
    expect(controller.system.getStats().understoryProxies).toBe(1);
    controller.dispose();
  });

  it("does nothing when the field is up to date", () => {
    const { controller, treeSystem } = makeController(0);
    const center = new THREE.Vector3(16, 0, 16);
    const sun = new THREE.Vector3(0.4, -0.8, 0.2).normalize();
    expect(controller.updateBudgeted(center, sun)).toBe(true);
    treeSystem.getLightingProxiesBudgeted.mockClear();
    expect(controller.updateBudgeted(center, sun)).toBe(false);
    expect(controller.updateBudgeted(center, sun)).toBe(false);
    expect(treeSystem.getLightingProxiesBudgeted).not.toHaveBeenCalled();
    controller.dispose();
  });
});
