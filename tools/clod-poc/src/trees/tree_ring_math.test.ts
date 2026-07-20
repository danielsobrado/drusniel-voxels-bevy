import { describe, expect, it } from "vitest";
import { DEFAULT_TREE_SETTINGS } from "./tree_config.js";
import { cloneTreeSettings } from "./tree_config_defaults.js";
import {
  treeAcceptMask,
  treeLodRing,
  treePcg2d,
  treeRingAcceptParams,
  treeRingLodParams,
  treeWorldCell,
  treeWorldCellFromSlot,
} from "./tree_ring_math.js";

describe("tree GPU ring math", () => {
  it("mirrors the deterministic integer pcg2d helper", () => {
    expect(treePcg2d(12, -7, 1337)).toEqual(treePcg2d(12, -7, 1337));
    expect(treePcg2d(12, -7, 1337)).not.toEqual(treePcg2d(13, -7, 1337));
    for (const value of treePcg2d(-2048, 4096, 0x9e3779b9)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("maps toroidal tree slots to the nearest congruent world cell", () => {
    expect(treeWorldCell(3, 5, 8, 2, 18, 22)).toEqual([11, 13]);
    expect(treeWorldCell(3, 5, 8, 2, -5, -9)).toEqual([-5, -3]);
    expect(treeWorldCellFromSlot(43, 8, 2, 18, 22)).toEqual([11, 13]);
  });

  it("rejects invalid tree terrain before the GPU path accepts a candidate", () => {
    const params = treeRingAcceptParams(DEFAULT_TREE_SETTINGS);

    expect(treeAcceptMask(10, 1, 32, 32, params)).toBe(0);
    expect(treeAcceptMask(24, params.slopeMinY - 0.01, 32, 32, params)).toBe(0);
    expect(treeAcceptMask(params.maxHeightM + 1, 1, 32, 32, params)).toBe(0);
  });

  it("applies terrain and parent-clump density as a stable acceptance mask", () => {
    const params = {
      ...treeRingAcceptParams(DEFAULT_TREE_SETTINGS),
      slopeMinY: 0,
      slopeFadeStartY: 0,
      slopeFadeEndY: 1,
      minHeightM: 0,
      maxHeightM: 80,
      highlandHeightM: 80,
      parentCellM: 8,
    };
    const first = treeAcceptMask(30, 0.95, 48, 64, params);
    const second = treeAcceptMask(30, 0.95, 48, 64, params);
    const lowGround = treeAcceptMask(18.4, 0.95, 48, 64, params);

    expect(first).toBe(second);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(1);
    expect(lowGround).toBeLessThan(first);
  });

  it("derives CPU LOD ring thresholds from tree settings", () => {
    const settings = cloneTreeSettings(DEFAULT_TREE_SETTINGS);
    settings.gpu.enabled = false;
    const params = treeRingLodParams(settings);

    expect(params.near).toBe(settings.distanceM * settings.lod.nearFraction);
    expect(params.mid).toBe(settings.distanceM * settings.lod.midFraction);
    expect(params.far).toBe(settings.distanceM * settings.lod.farFraction);
    expect(params.radius).toBe(settings.lod.impostorEndM);
    expect(params.band).toBe(settings.lod.crossfadeBandM * 0.5);
  });

  it("keeps the crossfade band for the GPU ring path", () => {
    const settings = cloneTreeSettings(DEFAULT_TREE_SETTINGS);
    settings.gpu.enabled = true;
    settings.gpu.scatterEnabled = true;
    settings.gpu.cullEnabled = true;
    settings.gpu.debugForceCpu = false;
    settings.lod.crossfadeEnabled = true;
    settings.lod.ditherEnabled = true;
    settings.lod.crossfadeBandM = 24;

    const params = treeRingLodParams(settings);
    expect(params.band).toBe(12);
    expect(params.radius).toBe(settings.lod.impostorEndM);
  });

  it("overlaps adjacent LOD rings with complementary fades", () => {
    const params = { near: 10, mid: 20, far: 30, radius: 40, band: 2 };
    const nearOnly = treeLodRing(4, params);
    const nearMid = treeLodRing(10, params);
    const midFar = treeLodRing(20, params);
    const farImpostor = treeLodRing(30, params);

    expect(nearOnly.active).toEqual({ near: true, mid: false, far: false, impostor: false });
    expect(nearOnly.fade.near).toBe(1);
    expect(nearMid.active.near).toBe(true);
    expect(nearMid.active.mid).toBe(true);
    expect(nearMid.fade.near + nearMid.fade.mid).toBeCloseTo(1, 12);
    expect(nearMid.fade.near).toBeCloseTo(0.5, 12);
    expect(midFar.fade.mid + midFar.fade.far).toBeCloseTo(1, 12);
    expect(farImpostor.fade.far + farImpostor.fade.impostor).toBeCloseTo(1, 12);
  });

  it("can disable overlap for strict one-LOD selection", () => {
    const params = { near: 10, mid: 20, far: 30, radius: 40, band: 0 };

    expect(treeLodRing(8, params).active).toEqual({ near: true, mid: false, far: false, impostor: false });
    expect(treeLodRing(18, params).active).toEqual({ near: false, mid: true, far: false, impostor: false });
    expect(treeLodRing(28, params).active).toEqual({ near: false, mid: false, far: true, impostor: false });
    expect(treeLodRing(38, params).active).toEqual({ near: false, mid: false, far: false, impostor: true });
  });
});
