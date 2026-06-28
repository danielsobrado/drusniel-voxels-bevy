import { describe, expect, it } from "vitest";
import {
  createFramePerfPhaseTiming,
  summarizeFramePerfSamples,
  type FramePerfSample,
} from "./perf_probe.js";

function sample(overrides: Partial<FramePerfSample> = {}): FramePerfSample {
  return {
    frameId: 1,
    frameMs: 16,
    selectionMs: 1,
    bubbleMs: 0,
    propsMs: 3,
    otherMs: 1,
    frameSetupMs: 1,
    selectionUpdateMs: 1,
    longViewDiagnosticsMs: 0,
    farSummaryMs: 0,
    constructionMs: 0,
    brushMs: 0,
    combatMs: 0,
    spellsMs: 0,
    terrainPhaseMs: 1,
    shadowProxyMs: 0,
    clodShadowMs: 0,
    canopyMs: 0,
    vegetationTotalMs: 2,
    borderOceanDebugMs: 0,
    statsSyncMs: 0,
    renderMs: 10,
    unattributedMs: 1,
    selectionCutMs: 0.2,
    selectionBookMs: 0.3,
    selectionInfoMs: 0.4,
    selectionOverlaysMs: 0.1,
    grassMs: 0.5,
    treesMs: 0.5,
    understoryMs: 0,
    forestLightingMs: 0,
    stonesMs: 0,
    customPropsMs: 0,
    waterMs: 1,
    deepOceanMs: 0,
    weatherMs: 0,
    propsRestMs: 1,
    propsUnattributedMs: 0,
    renderedCount: 4,
    terrainTriangles: 12000,
    chunkGroupsBuilt: 0,
    nearFieldChunkGroups: 0,
    interactionMode: "orbit",
    treeGpuStatus: "ring",
    treeTotalTrees: 100,
    treeVisiblePatches: 3,
    treePatches: 4,
    treeNearTrees: 10,
    treeMidTrees: 20,
    treeFarTrees: 30,
    treeImpostorTrees: 40,
    treeGpuCandidateCount: 120,
    treeGpuAcceptedCount: 100,
    treeGpuVisibleCount: 80,
    treeGpuDispatchMs: 0.2,
    ...overrides,
  };
}

describe("frame perf probe", () => {
  it("zeros every frame-loop phase bucket", () => {
    expect(createFramePerfPhaseTiming()).toEqual({
      frameSetupMs: 0,
      selectionUpdateMs: 0,
      longViewDiagnosticsMs: 0,
      farSummaryMs: 0,
      constructionMs: 0,
      brushMs: 0,
      combatMs: 0,
      spellsMs: 0,
      terrainPhaseMs: 0,
      shadowProxyMs: 0,
      clodShadowMs: 0,
      canopyMs: 0,
      borderOceanDebugMs: 0,
      statsSyncMs: 0,
    });
  });

  it("ranks detailed phase and prop buckets by p95", () => {
    const summary = summarizeFramePerfSamples([
      sample({ renderMs: 9, frameMs: 16, propsUnattributedMs: 1 }),
      sample({ renderMs: 24, frameMs: 32, statsSyncMs: 4, propsUnattributedMs: 7 }),
    ], 10, 2);

    expect(summary.sampleCount).toBe(2);
    expect(summary.metrics.frameMs.p95).toBe(32);
    expect(summary.broadBucketsByP95[0]).toMatchObject({ name: "renderMs", p95: 24 });
    expect(summary.propBucketsByP95[0]).toMatchObject({ name: "propsUnattributedMs", p95: 7 });
    expect(summary.counters.terrainTrianglesAvg).toBe(12000);
    expect(summary.counters.treeGpuStatusCounts).toEqual({ ring: 2 });
    expect(summary.counters.treeGpuVisibleCountAvg).toBe(80);
  });
});
