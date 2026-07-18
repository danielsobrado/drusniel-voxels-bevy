import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
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

function installCounters(): Record<string, number> {
  const counters: Record<string, number> = {};
  vi.stubGlobal("window", { __drusnielClod: { stats: { counters } } });
  return counters;
}

function makeInput(waterEnabled: boolean, selectionFrameId = 1): VegetationFramePhaseInput {
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
      updateBudgeted: vi.fn(() => false),
    } as unknown as VegetationFramePhaseInput["forestLightingController"],
    applyForestLightingToPropMaterials: vi.fn(),
    stoneController: { update: vi.fn() } as unknown as VegetationFramePhaseInput["stoneController"],
    propController: { update: propUpdate } as unknown as VegetationFramePhaseInput["propController"],
    waterController: {
      field: { sample: sampleWater },
      runtimeFeatures: {
        highQualityMaterial: true,
        ssr: true,
        refraction: true,
        caustics: true,
        atlasDrivenLevelCount: 4,
        clipmapOuterHalfSpanM: 768,
        clipmapGuaranteedHalfSpanM: 744,
      },
      clipmap: {
        isEnabled: waterEnabled,
        visibleLevelCount: 4,
        levelCount: 4,
        updateCostStats: {
          snaps: 8,
          fullRefills: 0,
          partialRefills: 0,
          fieldSamples: 0,
          staticSnaps: 8,
          indexRebuilds: 0,
        },
      },
      update,
      logDevInitOnce: vi.fn(),
    } as unknown as VegetationFramePhaseInput["waterController"],
    deepOceanSurface: null,
    deepOceanMaterial: null,
    weatherController: { update: vi.fn() } as unknown as VegetationFramePhaseInput["weatherController"],
    updateWeatherStats: vi.fn(),
    weatherStatsController: null,
    currentLighting: () => ({ sunDirection: new THREE.Vector3(0, 1, 0), skyLight: new THREE.Color(1, 1, 1) }),
    selectionFrameId,
    worldCells: 1024,
    collectTiming: true,
  };
}

describe("vegetation frame phase", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips water updates when water is disabled", () => {
    const input = makeInput(false);

    const timing = runVegetationFramePhase(input);

    expect(input.waterController.update).not.toHaveBeenCalled();
    expect(input.waterController.logDevInitOnce).not.toHaveBeenCalled();
    expect(timing.waterMs).toBeLessThan(0.5);
  });

  it("mirrors infinite hydrology diagnostics even when water rendering is disabled", () => {
    const counters = installCounters();
    const input = makeInput(false, 30);
    input.camera.position.set(1500, 40, -300);

    runVegetationFramePhase(input);

    expect(input.waterController.update).not.toHaveBeenCalled();
    expect(counters["infinite_hydrology_outside_sample_valid"]).toBe(1);
    expect(counters["infinite_hydrology_nonrepeat_ok"]).toBe(1);
    expect(counters["infinite_hydrology_camera_outside_startup"]).toBe(1);
    expect(counters["water_clipmap_enabled"]).toBe(0);
  });

  it("updates water around the streamed vegetation center", () => {
    const input = makeInput(true);
    input.camera.position.set(1500, 40, -300);

    runVegetationFramePhase(input);

    expect(input.waterController.update).toHaveBeenCalledOnce();
    expect(input.waterController.update).toHaveBeenCalledWith(1 / 60, input.ringCenter);
    expect(input.waterController.logDevInitOnce).toHaveBeenCalledOnce();
  });

  it("hides and skips the deep ocean when water is disabled", () => {
    const input = makeInput(false);
    const update = vi.fn();
    const mesh = { visible: true };
    input.deepOceanSurface = { mesh, update } as unknown as VegetationFramePhaseInput["deepOceanSurface"];
    input.deepOceanMaterial = {
      setTime: vi.fn(), updateCamera: vi.fn(), updateSunDirection: vi.fn(), updateHorizonColor: vi.fn(),
    } as unknown as VegetationFramePhaseInput["deepOceanMaterial"];

    runVegetationFramePhase(input);

    expect(mesh.visible).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(input.deepOceanMaterial!.setTime).not.toHaveBeenCalled();
  });

  it("mirrors infinite hydrology diagnostics when stats counters are installed", () => {
    const counters = installCounters();
    const input = makeInput(true, 30);
    input.camera.position.set(1500, 40, -300);

    runVegetationFramePhase(input);

    expect(counters["infinite_hydrology_outside_sample_valid"]).toBe(1);
    expect(counters["infinite_hydrology_nonrepeat_ok"]).toBe(1);
    expect(counters["infinite_hydrology_camera_outside_startup"]).toBe(1);
  });

  it("mirrors resolved water features and clipmap evidence every frame", () => {
    const counters = installCounters();
    const input = makeInput(true, 31);

    runVegetationFramePhase(input);

    expect(counters["water_high_quality_material_active"]).toBe(1);
    expect(counters["water_ssr_active"]).toBe(1);
    expect(counters["water_refraction_active"]).toBe(1);
    expect(counters["water_caustics_active"]).toBe(1);
    expect(counters["water_atlas_driven_level_count"]).toBe(4);
    expect(counters["water_clipmap_outer_half_span_m"]).toBe(768);
    expect(counters["water_clipmap_guaranteed_half_span_m"]).toBe(744);
    expect(counters["water_clipmap_enabled"]).toBe(1);
    expect(counters["water_clipmap_visible_levels"]).toBe(4);
    expect(counters["water_clipmap_level_count"]).toBe(4);
    expect(counters["water_clipmap_snaps"]).toBe(8);
    expect(counters["water_clipmap_field_samples"]).toBe(0);
  });

  it("keeps expensive hydrology diagnostics on their coarse cadence", () => {
    const counters = installCounters();
    const input = makeInput(true, 31);
    input.camera.position.set(1500, 40, -300);

    runVegetationFramePhase(input);

    expect(counters["infinite_hydrology_outside_sample_valid"]).toBeUndefined();
    expect(counters["water_clipmap_level_count"]).toBe(4);
    expect(input.waterController.update).toHaveBeenCalledOnce();
  });

  it("updates custom props with the vegetation ring center", () => {
    const input = makeInput(false);

    runVegetationFramePhase(input);

    expect(input.propController?.update).toHaveBeenCalledWith(input.camera, input.ringCenter);
  });
});
