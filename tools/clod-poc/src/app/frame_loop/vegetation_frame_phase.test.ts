import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { runVegetationFramePhase, type VegetationFramePhaseInput } from "./vegetation_frame_phase.js";
import type { ClodFrameLoopUiState } from "./ui_state.js";

function makeInput(waterEnabled: boolean): VegetationFramePhaseInput {
  const update = vi.fn();
  return {
    elapsedSeconds: 1,
    playerDelta: 1 / 60,
    ringCenter: new THREE.Vector3(),
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
    propController: null,
    waterController: {
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
});
