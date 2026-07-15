import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_VEGETATION_GPU_EARLY_REJECT_CONFIG } from "../vegetation/terrain_rejection_config.js";
import { DEFAULT_TREE_SETTINGS, cloneTreeSettings } from "./tree_config.js";
import {
  buildTreeRingClusterVisibilityMask,
  TreeRingClusterVisibilityCache,
  treeRingClusterMaskByteLength,
  treeRingSlotClusterVisible,
} from "./tree_ring_cluster_visibility.js";
import type { TreeTerrainSampler } from "./tree_instances.js";

beforeEach(() => {
  DEFAULT_VEGETATION_GPU_EARLY_REJECT_CONFIG.enabled = true;
});
afterEach(() => {
  DEFAULT_VEGETATION_GPU_EARLY_REJECT_CONFIG.enabled = false;
});

const EMPTY_SOURCE_COUNTS = {
  naadfFarSummary: 0,
  terrainVisibilitySampler: 0,
  conservativeFallback: 0,
};

describe("tree ring cluster visibility", () => {
  it("keeps every cluster visible when terrain visibility is disabled", () => {
    const settings = cloneTreeSettings(DEFAULT_TREE_SETTINGS);
    settings.distanceM = 24;
    settings.gpu.terrainVisibility.enabled = false;

    const mask = buildTreeRingClusterVisibilityMask({
      centerX: 64,
      centerZ: 64,
      cameraY: 10,
      worldCells: 512,
      settings,
      sampler: constantTerrain(100),
      clusterDimCells: 4,
    });

    expect(mask.hiddenClusters).toBe(0);
    expect(mask.visibleClusters).toBe(mask.words.length);
    expect(mask.reasonCounts.disabled).toBe(mask.words.length);
    expect(mask.sourceCounts.conservativeFallback).toBe(mask.words.length);
    expect(mask.candidateSlotsAfterPrefilter).toBe(mask.candidateSlotsBeforePrefilter);
    expect(mask.activeSlotIndices).toHaveLength(mask.candidateSlotsBeforePrefilter);
    expect(Array.from(mask.words).every((value) => value === 1)).toBe(true);
  });

  it("keeps unknown terrain clusters visible", () => {
    const settings = cloneTreeSettings(DEFAULT_TREE_SETTINGS);
    settings.distanceM = 24;
    settings.gpu.terrainVisibility.minDistanceM = 0;

    const mask = buildTreeRingClusterVisibilityMask({
      centerX: 64,
      centerZ: 64,
      cameraY: 10,
      worldCells: 512,
      settings,
      sampler: constantTerrain(Number.NaN),
      clusterDimCells: 4,
    });

    expect(mask.hiddenClusters).toBe(0);
    expect(mask.unknownKeptClusters).toBe(mask.words.length);
    expect(mask.candidateSlotsAfterPrefilter).toBe(mask.candidateSlotsBeforePrefilter);
    expect(Array.from(mask.words).every((value) => value === 1)).toBe(true);
  });

  it("marks terrain-hidden clusters as not visible before GPU slot dispatch", () => {
    const settings = cloneTreeSettings(DEFAULT_TREE_SETTINGS);
    settings.distanceM = 24;
    settings.gpu.terrainVisibility.minDistanceM = 0;
    settings.gpu.terrainVisibility.heightMarginM = 0;
    settings.gpu.terrainVisibility.crownHeightM = 0;

    const mask = buildTreeRingClusterVisibilityMask({
      centerX: 64,
      centerZ: 64,
      cameraY: 0,
      worldCells: 512,
      settings,
      sampler: constantTerrain(100),
      clusterDimCells: 4,
    });

    expect(mask.hiddenClusters).toBeGreaterThan(0);
    expect(mask.reasonCounts.terrain_hidden).toBe(mask.hiddenClusters);
    expect(mask.sourceCounts.terrainVisibilitySampler).toBeGreaterThan(0);
    expect(mask.candidateSlotsAfterPrefilter).toBeLessThan(mask.candidateSlotsBeforePrefilter);
    expect(mask.activeSlotIndices.length).toBe(mask.candidateSlotsAfterPrefilter);
    expect(mask.skippedCandidateEstimate).toBe(mask.candidateSlotsBeforePrefilter - mask.candidateSlotsAfterPrefilter);
    expect(Array.from(mask.words).some((value) => value === 0)).toBe(true);
  });

  it("reuses cached decisions for unchanged camera and terrain revision", () => {
    const settings = cloneTreeSettings(DEFAULT_TREE_SETTINGS);
    settings.distanceM = 24;
    settings.gpu.terrainVisibility.minDistanceM = 0;
    settings.gpu.terrainVisibility.heightMarginM = 0;
    settings.gpu.terrainVisibility.crownHeightM = 0;
    const cache = new TreeRingClusterVisibilityCache();

    const first = buildTreeRingClusterVisibilityMask({
      centerX: 64,
      centerZ: 64,
      cameraY: 0,
      worldCells: 512,
      settings,
      sampler: constantTerrain(100),
      clusterDimCells: 4,
      terrainRevision: 11,
      cache,
    });
    const second = buildTreeRingClusterVisibilityMask({
      centerX: 64,
      centerZ: 64,
      cameraY: 0,
      worldCells: 512,
      settings,
      sampler: constantTerrain(100),
      clusterDimCells: 4,
      terrainRevision: 11,
      cache,
    });

    expect(first.cacheHits).toBe(0);
    expect(first.cacheMisses).toBeGreaterThan(0);
    expect(second.cacheHits).toBe(first.cacheMisses);
    expect(second.cacheMisses).toBe(0);
    expect(second.activeSlotIndices).toEqual(first.activeSlotIndices);
    expect(second.sourceCounts.terrainVisibilitySampler).toBe(first.sourceCounts.terrainVisibilitySampler);
  });

  it("reuses the whole mask inside the same camera bucket", () => {
    const settings = cloneTreeSettings(DEFAULT_TREE_SETTINGS);
    settings.distanceM = 24;
    settings.gpu.terrainVisibility.minDistanceM = 0;
    settings.gpu.terrainVisibility.heightMarginM = 0;
    settings.gpu.terrainVisibility.crownHeightM = 0;
    const cache = new TreeRingClusterVisibilityCache();

    const first = buildTreeRingClusterVisibilityMask({
      centerX: 64,
      centerZ: 64,
      cameraY: 0,
      worldCells: 512,
      settings,
      sampler: constantTerrain(100),
      clusterDimCells: 4,
      terrainRevision: 11,
      cache,
    });
    const second = buildTreeRingClusterVisibilityMask({
      centerX: 64.5,
      centerZ: 64.5,
      cameraY: 0,
      worldCells: 512,
      settings,
      sampler: constantTerrain(100),
      clusterDimCells: 4,
      terrainRevision: 11,
      cache,
    });

    expect(second.cacheMisses).toBe(0);
    expect(second.cacheHits).toBe(first.hiddenClusters + first.visibleClusters);
    expect(second.words).toBe(first.words);
    expect(second.activeSlotIndices).toBe(first.activeSlotIndices);
  });

  it("rebuilds the whole mask when the camera leaves the cached bucket", () => {
    const settings = cloneTreeSettings(DEFAULT_TREE_SETTINGS);
    settings.distanceM = 24;
    settings.gpu.terrainVisibility.minDistanceM = 0;
    settings.gpu.terrainVisibility.heightMarginM = 0;
    settings.gpu.terrainVisibility.crownHeightM = 0;
    const cache = new TreeRingClusterVisibilityCache();

    const first = buildTreeRingClusterVisibilityMask({
      centerX: 64,
      centerZ: 64,
      cameraY: 0,
      worldCells: 512,
      settings,
      sampler: constantTerrain(100),
      clusterDimCells: 4,
      terrainRevision: 11,
      cache,
    });
    const second = buildTreeRingClusterVisibilityMask({
      centerX: 73,
      centerZ: 64,
      cameraY: 0,
      worldCells: 512,
      settings,
      sampler: constantTerrain(100),
      clusterDimCells: 4,
      terrainRevision: 11,
      cache,
    });

    expect(second.cacheMisses).toBeGreaterThan(0);
    expect(second.words).not.toBe(first.words);
    expect(second.activeSlotIndices).not.toBe(first.activeSlotIndices);
  });

  it("maps slots to their cluster visibility", () => {
    const settings = cloneTreeSettings(DEFAULT_TREE_SETTINGS);
    settings.distanceM = 24;
    const byteLength = treeRingClusterMaskByteLength(settings, 4);
    const words = new Uint32Array(byteLength / Uint32Array.BYTES_PER_ELEMENT).fill(1);
    const mask = {
      grid: 15,
      clusterDimCells: 4,
      clusterGrid: 4,
      words,
      activeSlotIndices: new Uint32Array([4]),
      hiddenClusters: 1,
      visibleClusters: words.length - 1,
      farSummaryConsultedClusters: 0,
      unknownKeptClusters: 0,
      candidateSlotsBeforePrefilter: 225,
      candidateSlotsAfterPrefilter: 1,
      skippedCandidateEstimate: 224,
      cacheHits: 0,
      cacheMisses: 0,
      reasonCounts: {
        visible: words.length - 1,
        terrain_hidden: 1,
        unknown_kept: 0,
        near_forced_visible: 0,
        disabled: 0,
      },
      sourceCounts: { ...EMPTY_SOURCE_COUNTS, terrainVisibilitySampler: words.length },
    };
    mask.words[0] = 0;

    expect(treeRingSlotClusterVisible(mask, 0)).toBe(false);
    expect(treeRingSlotClusterVisible(mask, 1)).toBe(false);
    expect(treeRingSlotClusterVisible(mask, 15)).toBe(false);
    expect(treeRingSlotClusterVisible(mask, 4)).toBe(true);
  });
});

function constantTerrain(height: number): TreeTerrainSampler {
  return {
    surfaceHeight: () => height,
    surfaceNormal: () => [0, 1, 0],
    materialWeights: () => [1, 0, 0, 0],
  };
}
