import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { runVegetationFramePhase, type VegetationFramePhaseInput } from "./vegetation_frame_phase.js";
import type { ClodFrameLoopUiState } from "./ui_state.js";

function sampleWater(x: number, z: number) {
  const terrainY = x * 0.01 + z * 0.001;
  return {
    waterY: terrainY + 1,
    terrainY,
    depth: 1,
    bodyMask: x > 1024 || z < 0 ? 0.5 : 0,
    flow: { x: 0, z: 0, speed: 0, progress: 0, drop: 0 },
  };
}

function makeInput(waterEnabled: boolean): VegetationFramePhaseInput {
  const update = vi.fn();
  const propUpdate = vi.fn();
  return {
    elapsedSeconds: 1,
    playerDelta: 1 / 60,
    ringCenter: new THREE.Vector3(12, 3, -8),
    grassCenter: new THREE.Vector3(),
    camera: new THREE.PerspectiveCamera(),
    state: { waterEnabled, weatherMode: "off" } as ClodFrameLoopUiState,
    grassController: { update: vi.fn() } as unknown as VegetationFramePhaseInput["grassController"],
    treeController: {
      update: vi.fn(),
      system: { getLightingProxies: () => [] },
    } as unknown as VegetationFramePhaseInput["treeController"],
    understoryController: {
      update: vi.fn(),
      system: { getLightingProxies: () => [] },
    } as unknown as VegetationFramePhaseInput["understoryController"],
    forestLightingController: {
      shouldUpdate: () => false,
      update: vi.fn(),
    } as unknown as VegetationFramePhaseInput["forestLightingController"],
    applyForestLightingToPropMaterials: vi.fn(),
    stoneController: { update: vi.fn() } as unknown as VegetationFramePhaseInput["stoneController"],
    propController: { update: propUpdate } as unknown as VegetationFramePhaseInput["propController"],
    waterController: {
      field: { sample: sampleWater },
      update,
      logDevInitOnce: vi.fn(),
    } as unknown as VegetationFramePhaseInput["waterController"],
    deepOceanSurface: null,
    deepOceanMaterial: null,
    weatherController: { update: vi.fn() } as unknown as VegetationFramePhaseInput["weatherController"],
    updateWeatherStats: vi.fn(),
    weatherStatsController: null,
    currentLighting: () => ({ sunDirection: new THREE.Vector3(0, 1, 0), skyLight: new THREE.Color(1, 1, 1) }),
    selectionFrameId: 1,
    worldCells: 1024,
    collectTiming: true,
  };
}

describe("vegetation frame phase", () => {
  it("skips water updates when water is disabled", () => {
    const input = makeInput(false);

    const timing = runVegetationFramePhase(input);

    expect(input.waterController.update).not.toHaveBeenCalled();
    expect(input.waterController.logDevInitOnce).not.toHaveBeenCalled();
    expect(timing.waterMs).toBeLessThan(0.5);
  });

  it("updates water when water is enabled", () => {
    const input = makeInput(true);

    runVegetationFramePhase(input);

    expect(input.waterController.update).toHaveBeenCalledOnce();
    expect(input.waterController.logDevInitOnce).toHaveBeenCalledOnce();
  });

  it("mirrors infinite hydrology diagnostics when stats counters are installed", () => {
    const counters: Record<string, number> = {};
    vi.stubGlobal("window", { __drusnielClod: { stats: { counters } } });
    const input = makeInput(true);
    input.camera.position.set(1500, 40, -300);

    runVegetationFramePhase(input);

    expect(counters["infinite_hydrology_outside_sample_valid"]).toBe(1);
    expect(counters["infinite_hydrology_nonrepeat_ok"]).toBe(1);
    expect(counters["infinite_hydrology_camera_outside_startup"]).toBe(1);
    vi.unstubAllGlobals();
  });

  it("updates custom props with the vegetation ring center", () => {
    const input = makeInput(false);

    runVegetationFramePhase(input);

    expect(input.propController?.update).toHaveBeenCalledWith(input.camera, input.ringCenter);
  });
});
