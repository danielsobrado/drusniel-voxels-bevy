import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { BiomeVisualState } from "../environment/biome_visual_state.js";
import { cloneEnvironmentalMaskSettings } from "../environment_masks/environment_mask_config.js";
import { HYDROLOGY_BODY_RIVER } from "./hydrologyGrid.js";
import type { WaterField } from "./waterField.js";
import { RiverMistOverlay } from "./riverMistOverlay.js";

function runtimeSettings() {
  const mask = cloneEnvironmentalMaskSettings().riverMist;
  mask.minFlowStrength = 0.01;
  mask.maxShoreDistanceM = 14;
  mask.particles = {
    ...mask.particles,
    spawnRadiusM: 4,
    spacingM: 2,
    sampleHintM: 16,
    emitIntervalS: 0.1,
    maxParticles: 8,
    maxEmittersPerTick: 8,
    scanCellsPerFrame: 64,
    spawnProbability: 1,
  };
  return { enabled: true, mask };
}

describe("RiverMistOverlay", () => {
  it("uses a coarse sample hint and respects the fixed particle budget", () => {
    const sampleForCellSize = vi.fn((_x: number, _z: number, _cellSize: number) => ({
      waterY: 4,
      terrainY: 3.5,
      depth: 0.5,
      bodyMask: 1,
      bodyKind: HYDROLOGY_BODY_RIVER,
      shoreDistance: 0,
      flow: { x: 1, z: 0, speed: 1, progress: 0, drop: 0 },
    }));
    const scene = new THREE.Scene();
    const overlay = new RiverMistOverlay(
      scene,
      { sampleForCellSize } as unknown as WaterField,
      {
        settings: runtimeSettings(),
        readBiomeState: () => ({ enabled: true, morningMist: 1 } as BiomeVisualState),
      },
    );

    overlay.update(0.2, new THREE.Vector3(0, 0, 0));
    const stats = overlay.getStats();
    expect(stats.particles).toBeGreaterThan(0);
    expect(stats.particles).toBeLessThanOrEqual(8);
    expect(stats.lastEmitters).toBeLessThanOrEqual(8);
    expect(sampleForCellSize).toHaveBeenCalled();
    expect(sampleForCellSize.mock.calls.every((call) => call[2] === 16)).toBe(true);

    overlay.setVisible(false);
    expect(overlay.getStats().enabled).toBe(false);
    expect(overlay.getStats().particles).toBe(0);
    overlay.dispose();
    expect(scene.getObjectByName("river-mist-overlay")).toBeUndefined();
  });
});
