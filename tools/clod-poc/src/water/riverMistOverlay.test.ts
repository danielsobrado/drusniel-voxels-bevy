import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { BiomeVisualState } from "../environment/biome_visual_state.js";
import { cloneEnvironmentalMaskSettings } from "../environment_masks/environment_mask_config.js";
import type { EnvironmentQuery, EnvironmentQueryMeta } from "../environment_query/types.js";
import type { LargePropOcclusionField } from "../props/large_prop_occlusion_field.js";
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

const biomeState = () => ({ enabled: true, morningMist: 1 } as BiomeVisualState);

function validMeta(cellSizeM: number): EnvironmentQueryMeta {
  return { source: "hydrology-cpu", revision: 4, valid: true, cellSizeM };
}

function wetRiverSample() {
  return {
    waterY: 4,
    terrainY: 3.5,
    depth: 0.5,
    bodyMask: 1,
    bodyKind: HYDROLOGY_BODY_RIVER,
    shoreDistance: 0,
    flow: { x: 1, z: 0, speed: 1, progress: 0, drop: 0 },
  };
}

describe("RiverMistOverlay", () => {
  it("uses the coarse bypass hint and legacy fallback only without an active query", () => {
    const sampleForCellSize = vi.fn((_x: number, _z: number, _cellSize: number) => wetRiverSample());
    const scene = new THREE.Scene();
    const overlay = new RiverMistOverlay(
      scene,
      { sampleForCellSize } as unknown as WaterField,
      {
        settings: runtimeSettings(),
        minimumSampleHintM: 20,
        readBiomeState: biomeState,
        readEnvironmentQuery: () => null,
      },
    );

    overlay.update(0.2, new THREE.Vector3(0, 0, 0));
    const stats = overlay.getStats();
    expect(stats.particles).toBeGreaterThan(0);
    expect(stats.particles).toBeLessThanOrEqual(8);
    expect(stats.lastEmitters).toBeLessThanOrEqual(8);
    expect(stats.lastEnvironmentSamples).toBe(0);
    expect(stats.lastFallbackSamples).toBe(stats.lastSampledCells);
    expect(stats.lastInvalidSamples).toBe(0);
    expect(stats.lastPropOcclusionSamples).toBe(0);
    expect(stats.lastPropOcclusionClipped).toBe(0);
    expect(sampleForCellSize).toHaveBeenCalled();
    expect(sampleForCellSize.mock.calls.every((call) => call[2] === 20)).toBe(true);

    const callsAfterScan = sampleForCellSize.mock.calls.length;
    overlay.update(0.05, new THREE.Vector3(0, 0, 0));
    expect(sampleForCellSize).toHaveBeenCalledTimes(callsAfterScan);
    overlay.update(0.06, new THREE.Vector3(0, 0, 0));
    expect(sampleForCellSize.mock.calls.length).toBeGreaterThan(callsAfterScan);

    overlay.setVisible(false);
    expect(overlay.getStats().enabled).toBe(false);
    expect(overlay.getStats().particles).toBe(0);
    overlay.dispose();
    expect(scene.getObjectByName("river-mist-overlay")).toBeUndefined();
  });

  it("uses the active environment query and fails closed on invalid authority", () => {
    const fallback = vi.fn();
    let valid = true;
    const water = vi.fn((_x: number, _z: number, hintM?: number) => ({
      waterY: 4,
      carvedBedY: 3.5,
      depth: 0.5,
      wetMask: 1,
      shoreDistanceM: 0,
      bodyKind: HYDROLOGY_BODY_RIVER,
      bodyId: 8,
      meta: { ...validMeta(hintM ?? 0), valid },
    }));
    const river = vi.fn((_x: number, _z: number, hintM?: number) => ({
      flowX: 1,
      flowZ: 0,
      flowStrength: 1,
      bedDrop: 0,
      rapidMask: 0,
      channelCenterWeight: 1,
      bankContactWeight: 0,
      gravelBarMask: 0,
      meta: { ...validMeta(hintM ?? 0), valid },
    }));
    const query = { water, river } as unknown as EnvironmentQuery;
    const overlay = new RiverMistOverlay(
      new THREE.Scene(),
      { sampleForCellSize: fallback } as unknown as WaterField,
      {
        settings: runtimeSettings(),
        minimumSampleHintM: 20,
        readBiomeState: biomeState,
        readEnvironmentQuery: () => query,
      },
    );

    overlay.update(0.2, new THREE.Vector3(0, 0, 0));
    const validStats = overlay.getStats();
    expect(validStats.particles).toBeGreaterThan(0);
    expect(validStats.lastEnvironmentSamples).toBe(validStats.lastSampledCells);
    expect(validStats.lastFallbackSamples).toBe(0);
    expect(validStats.lastInvalidSamples).toBe(0);
    expect(fallback).not.toHaveBeenCalled();
    expect(water.mock.calls.every((call) => call[2] === 20)).toBe(true);
    expect(river.mock.calls.every((call) => call[2] === 20)).toBe(true);

    valid = false;
    overlay.update(0.11, new THREE.Vector3(0, 0, 0));
    const invalidStats = overlay.getStats();
    expect(invalidStats.lastEnvironmentSamples).toBe(invalidStats.lastSampledCells);
    expect(invalidStats.lastInvalidSamples).toBe(invalidStats.lastSampledCells);
    expect(invalidStats.lastFallbackSamples).toBe(0);
    expect(fallback).not.toHaveBeenCalled();
    overlay.dispose();
  });

  it("suppresses spawning inside an active fog-occluding prop volume", () => {
    const sampleForCellSize = vi.fn(() => wetRiverSample());
    const propField = {
      sampleInto(_x: number, _z: number, out: Record<string, unknown>) {
        Object.assign(out, {
          valid: true,
          enabled: true,
          revision: 2,
          fogOccupancy: 1,
          fogBottomY: 0,
          fogTopY: 10,
        });
        return out;
      },
      mistClipStrength() {
        return 1;
      },
    } as unknown as LargePropOcclusionField;
    const overlay = new RiverMistOverlay(
      new THREE.Scene(),
      { sampleForCellSize } as unknown as WaterField,
      {
        settings: runtimeSettings(),
        readBiomeState: biomeState,
        readEnvironmentQuery: () => null,
        readPropOcclusionField: () => propField,
      },
    );

    overlay.update(0.2, new THREE.Vector3());
    const stats = overlay.getStats();
    expect(stats.lastPropOcclusionSamples).toBeGreaterThan(0);
    expect(stats.lastPropOcclusionClipped).toBe(stats.lastPropOcclusionSamples);
    expect(stats.lastEmitters).toBe(0);
    expect(stats.particles).toBe(0);
    overlay.dispose();
  });
});
