import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { ClodPageNode } from "../types.js";
import type { TreeSettings } from "./tree_config.js";
import type { TreeTerrainSampler } from "./tree_instances.js";
import {
  createEmptyTreeEarlyTerrainRejectionStats,
  estimateTreePatchCandidateCount,
  recordTreeEarlyTerrainRejection,
  rejectTreePatchBeforeGeneration,
} from "./tree_patch_terrain_rejection.js";

function makeNode(): ClodPageNode {
  return {
    id: "node-a",
    level: 0,
    footprint: { minX: 100, minZ: 0, maxX: 116, maxZ: 16 },
  } as ClodPageNode;
}

function makeSettings(enabled = true): TreeSettings {
  return {
    enabled: true,
    placement: { spacingM: 4 },
    gpu: {
      terrainVisibility: {
        enabled,
        minDistanceM: 0,
        sampleCount: 1,
        heightMarginM: 1,
        crownHeightM: 5,
      },
    },
  } as TreeSettings;
}

function makeSampler(surfaceHeight: (x: number, z: number) => number): TreeTerrainSampler {
  return {
    surfaceHeight,
    surfaceNormal: () => [0, 1, 0],
    materialWeights: () => [1, 0, 0, 0],
  };
}

describe("early tree terrain rejection", () => {
  it("keeps clusters when no sampler is available", () => {
    const decision = rejectTreePatchBeforeGeneration({
      node: makeNode(),
      settings: makeSettings(),
      sampler: undefined,
      cameraPosition: new THREE.Vector3(0, 0, 0),
      worldCells: 512,
    });

    expect(decision.reject).toBe(false);
    expect(decision.reason).toBe("unknown_kept");
  });

  it("rejects only when every footprint probe is terrain hidden", () => {
    const sampler = makeSampler((x) => (x > 20 && x < 90 ? 100 : 0));

    const decision = rejectTreePatchBeforeGeneration({
      node: makeNode(),
      settings: makeSettings(),
      sampler,
      cameraPosition: new THREE.Vector3(0, 0, 0),
      worldCells: 512,
    });

    expect(decision.reject).toBe(true);
    expect(decision.reason).toBe("terrain_hidden");
    expect(decision.skippedCandidateEstimate).toBe(16);
  });

  it("keeps mixed clusters when any probe remains visible", () => {
    const sampler = makeSampler((x, z) => (z < 1 && x > 20 && x < 90 ? 100 : 0));

    const decision = rejectTreePatchBeforeGeneration({
      node: makeNode(),
      settings: makeSettings(),
      sampler,
      cameraPosition: new THREE.Vector3(0, 0, 0),
      worldCells: 512,
    });

    expect(decision.reject).toBe(false);
  });

  it("records rejected patches and skipped candidate estimates", () => {
    const stats = createEmptyTreeEarlyTerrainRejectionStats();

    recordTreeEarlyTerrainRejection(stats, {
      reject: true,
      reason: "terrain_hidden",
      skippedCandidateEstimate: 12,
    });

    expect(stats.testedPatches).toBe(1);
    expect(stats.rejectedPatches).toBe(1);
    expect(stats.skippedCandidateEstimate).toBe(12);
    expect(stats.reasonCounts.terrain_hidden).toBe(1);
  });

  it("estimates candidates with the same spacing grid as generation", () => {
    expect(estimateTreePatchCandidateCount(makeNode().footprint, makeSettings())).toBe(16);
  });
});
