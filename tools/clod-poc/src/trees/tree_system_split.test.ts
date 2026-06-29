import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { PageFootprint } from "../types.js";
import {
  cloneTreeSettings,
  createEmptyTreeSystemStats,
  formatTreeLodCounts,
  packTreeSystemGpuFrustumPlanes,
  treeDistance2d,
  treeFootprintCenterX,
  treeFootprintCenterZ,
  treeFootprintRadius,
  treeSystemUsesGpuRingDraw,
  visibleTreeLodCount,
} from "./index.js";

describe("tree system split helpers", () => {
  it("keeps footprint and distance math isolated", () => {
    const footprint: PageFootprint = { minX: 10, minZ: 20, maxX: 42, maxZ: 44 };
    expect(treeFootprintCenterX(footprint)).toBe(26);
    expect(treeFootprintCenterZ(footprint)).toBe(32);
    expect(treeFootprintRadius(footprint)).toBeCloseTo(20);
    expect(treeDistance2d(0, 0, 3, 4)).toBe(5);
  });

  it("counts and formats lod buckets", () => {
    const counts = { near: 1, mid: 2, far: 3, impostor: 4 };
    expect(visibleTreeLodCount(counts)).toBe(10);
    expect(formatTreeLodCounts(counts)).toBe("1/2/3/4");
  });

  it("creates the default tree stats snapshot", () => {
    expect(createEmptyTreeSystemStats()).toMatchObject({
      totalTrees: 0,
      patches: 0,
      visiblePatches: 0,
      culledPatches: 0,
      gpuStatus: "disabled",
      gpuDispatchMs: null,
      impostorStatus: "disabled",
      generatedCandidates: 0,
      acceptedCandidates: 0,
    });
  });

  it("keeps GPU ring draw policy explicit", () => {
    const settings = cloneTreeSettings();
    settings.enabled = true;
    settings.gpu.enabled = true;
    settings.gpu.scatterEnabled = true;
    settings.gpu.cullEnabled = true;
    settings.gpu.debugForceCpu = false;
    expect(treeSystemUsesGpuRingDraw(settings)).toBe(true);
    settings.gpu.debugForceCpu = true;
    expect(treeSystemUsesGpuRingDraw(settings)).toBe(false);
  });

  it("packs permissive frustum planes without a camera", () => {
    const planes = packTreeSystemGpuFrustumPlanes(undefined);
    expect(planes).toHaveLength(24);
    for (let i = 0; i < 6; i++) {
      expect(planes[i * 4]).toBe(0);
      expect(planes[i * 4 + 1]).toBe(0);
      expect(planes[i * 4 + 2]).toBe(0);
      expect(planes[i * 4 + 3]).toBe(1_000_000);
    }
  });

  it("packs finite frustum planes from a camera", () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 2, 10);
    camera.lookAt(0, 0, 0);
    const planes = packTreeSystemGpuFrustumPlanes(camera);
    for (const value of planes) expect(Number.isFinite(value)).toBe(true);
  });
});
