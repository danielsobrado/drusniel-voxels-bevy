import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { PageFootprint } from "../types.js";
import type { GrassGpuRingStats } from "../gpu/grass_ring_compute.js";
import { cloneGrassSettings, DEFAULT_GRASS_SETTINGS, type GrassSettings } from "./grass_config.js";
import type { GrassBladeInstance } from "./grass_cpu_patch.js";
import { createBladeGeometry, createGrassClumpGeometry, createGrassTuftGeometry } from "./grass_geometry.js";
import { emptyGrassGpuRingStats } from "./grass_gpu_ring_runtime.js";
import { GrassPatchFactory } from "./grass_patch_factory.js";
import {
  clampGrassFootprint,
  grassFootprintCenterX,
  grassFootprintCenterZ,
  grassFootprintRadius,
} from "./grass_patch_footprint.js";
import { updateGrassPatchVisibility } from "./grass_patch_visibility.js";
import type { GrassPatch } from "./grass_system_support.js";
import { buildGrassStats } from "./grass_system_stats_builder.js";

describe("grass system extracted helpers", () => {
  it("clamps and measures patch footprints", () => {
    const footprint: PageFootprint = { minX: -4, minZ: 2, maxX: 40, maxZ: 30 };
    const clamped = clampGrassFootprint(footprint, 32);

    expect(clamped).toEqual({ minX: 0, minZ: 2, maxX: 32, maxZ: 30 });
    expect(grassFootprintCenterX(clamped)).toBe(16);
    expect(grassFootprintCenterZ(clamped)).toBe(16);
    expect(grassFootprintRadius(clamped)).toBeCloseTo(Math.hypot(32, 28) * 0.5);
  });

  it("updates terrain-patch visibility tiers without rebuilding patch data", () => {
    const settings = grassSettings({ shaderMode: "terrain-patch-v2", distance: 100 });
    settings.lod.nearFraction = 0.25;
    settings.lod.midFraction = 0.5;
    settings.ring.farDistanceFraction = 0.75;
    const patch = makePatch(4);

    updateGrassPatchVisibility({ patch, distance: 20, settings });
    expect(patch.visibleTier).toBe("near");
    expect(patch.meshes.map((mesh) => mesh.visible)).toEqual([true, false, false, false]);

    updateGrassPatchVisibility({ patch, distance: 35, settings });
    expect(patch.visibleTier).toBe("mid");
    expect(patch.meshes.map((mesh) => mesh.visible)).toEqual([false, true, false, false]);

    updateGrassPatchVisibility({ patch, distance: 60, settings });
    expect(patch.visibleTier).toBe("far");
    expect(patch.meshes.map((mesh) => mesh.visible)).toEqual([false, false, true, false]);

    updateGrassPatchVisibility({ patch, distance: 85, settings });
    expect(patch.visibleTier).toBe("super");
    expect(patch.meshes.map((mesh) => mesh.visible)).toEqual([false, false, false, true]);

    updateGrassPatchVisibility({ patch, distance: 120, settings });
    expect(patch.visibleTier).toBe("hidden");
    expect(patch.meshes.map((mesh) => mesh.visible)).toEqual([false, false, false, false]);
  });

  it("builds patch stats from patch state", () => {
    const stats = buildGrassStats({
      mode: "terrain-patch-v2",
      ringMode: false,
      activeGpu: false,
      patches: [
        { ...makePatch(1), visibleTier: "near", bladeCount: 10, midBladeCount: 3 },
        { ...makePatch(1), visibleTier: "mid", bladeCount: 20, midBladeCount: 5 },
        { ...makePatch(1), visibleTier: "hidden", bladeCount: 30, midBladeCount: 7 },
      ],
      ringMeshes: [],
      ringTierCounts: { near: 0, mid: 0, far: 0, super: 0 },
      ringBladeCount: 0,
      bladeCount: 60,
      generationStats: {
        generatedCandidates: 80,
        acceptedCandidates: 60,
        edgeSuppressedCandidates: 2,
      },
      patchRebuildCount: 3,
      buildMs: 4.5,
      gpuRingStats: makeGpuRingStats("disabled"),
    });

    expect(stats.visiblePatches).toBe(2);
    expect(stats.culledPatches).toBe(1);
    expect(stats.nearPatches).toBe(1);
    expect(stats.midPatches).toBe(1);
    expect(stats.midBladeCount).toBe(15);
    expect(stats.generatedCandidates).toBe(80);
    expect(stats.patchRebuildCount).toBe(3);
  });

  it("builds active GPU ring stats from ring counters", () => {
    const stats = buildGrassStats({
      mode: "webgpu-ring-v1",
      ringMode: true,
      activeGpu: true,
      patches: [{ ...makePatch(1), visibleTier: "near", bladeCount: 99, midBladeCount: 40 }],
      ringMeshes: [{ visible: true }, { visible: false }],
      ringTierCounts: { near: 5, mid: 7, far: 11, super: 13 },
      ringBladeCount: 36,
      bladeCount: 99,
      generationStats: {
        generatedCandidates: 100,
        acceptedCandidates: 90,
        edgeSuppressedCandidates: 1,
      },
      patchRebuildCount: 2,
      buildMs: 1.5,
      gpuRingStats: {
        ...makeGpuRingStats("ready"),
        candidateCount: 120,
        generatedCandidates: 110,
        acceptedCandidates: 36,
        counts: { near: 5, mid: 7, far: 11, super: 13 },
        submitMs: 0.25,
        readbackMs: 0.5,
      },
    });

    expect(stats.blades).toBe(36);
    expect(stats.patches).toBe(2);
    expect(stats.visiblePatches).toBe(1);
    expect(stats.nearPatches).toBe(1);
    expect(stats.midBladeCount).toBe(31);
    expect(stats.gpuRingCandidateCount).toBe(120);
    expect(stats.gpuRingVisibleSuper).toBe(13);
    expect(stats.gpuRingDispatchMs).toBe(0.25);
  });

  it("creates terrain patches with preserved LOD thinning", () => {
    const settings = grassSettings({ shaderMode: "terrain-patch-v2" });
    settings.nearCrossedQuads = false;
    settings.lod.midInstanceFraction = 0.5;
    settings.lod.farInstanceFraction = 0.25;
    const factory = createPatchFactory(settings);
    const patch = factory.createPatch("node-1", { minX: 4, minZ: 8, maxX: 20, maxZ: 24 }, makeInstances(8));

    expect(patch.meshes).toHaveLength(4);
    expect(patch.centerX).toBe(12);
    expect(patch.centerZ).toBe(16);
    expect(patch.radius).toBeCloseTo(Math.hypot(16, 16) * 0.5);
    expect(patch.bladeCount).toBe(8);
    expect(patch.midBladeCount).toBe(7);
  });
});

function grassSettings(overrides: Partial<GrassSettings> = {}): GrassSettings {
  return { ...cloneGrassSettings(DEFAULT_GRASS_SETTINGS), ...overrides };
}

function makePatch(meshCount: number): GrassPatch {
  return {
    nodeId: "node",
    meshes: Array.from({ length: meshCount }, () => new THREE.Mesh(new THREE.InstancedBufferGeometry(), new THREE.MeshBasicMaterial())),
    centerX: 0,
    centerZ: 0,
    radius: 0,
    bladeCount: 0,
    midBladeCount: 0,
    visibleTier: "hidden",
  };
}

function makeGpuRingStats(status: GrassGpuRingStats["status"]): GrassGpuRingStats {
  return emptyGrassGpuRingStats(status);
}

function createPatchFactory(settings: GrassSettings): GrassPatchFactory {
  return new GrassPatchFactory({
    settings,
    classicBladeGeometry: createBladeGeometry(),
    terrainPatchNearGeometry: createGrassClumpGeometry(settings.blade.nearBladesPerInstance, settings.blade.nearSegments, settings),
    terrainPatchNearCrossedGeometry: createGrassClumpGeometry(settings.blade.nearBladesPerInstance, settings.blade.nearSegments, settings),
    terrainPatchMidGeometry: createGrassClumpGeometry(settings.blade.midBladesPerInstance, settings.blade.midSegments, settings),
    terrainPatchFarGeometry: createGrassTuftGeometry(settings),
    terrainPatchSuperGeometry: createGrassTuftGeometry(settings.blade.farTuftWidthM * 1.45 / Math.max(settings.blade.widthM, 0.001)),
    injectedGeometryBuilder: null,
    materialFor: () => new THREE.MeshBasicMaterial(),
  });
}

function makeInstances(count: number): GrassBladeInstance[] {
  return Array.from({ length: count }, (_, index) => ({
    offset: [index, 12, index + 1],
    height: 1,
    rotationY: index * 0.1,
    phase: 0.3,
    colorMix: 0,
    normalY: 1,
    terrainNormal: [0, 1, 0],
    edgeFade: 1,
    widthScale: 1,
  }));
}
