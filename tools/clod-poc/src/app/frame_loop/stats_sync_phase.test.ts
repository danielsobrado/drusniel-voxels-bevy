import { describe, expect, it, vi } from "vitest";
import type { ForestLightingStats } from "../../forest_lighting/index.js";
import { emptyUnderstoryStats, type UnderstoryStats } from "../../understory/index.js";
import { runStatsSyncPhase } from "./stats_sync_phase.js";
import type { StatsPresenter } from "./stats_presenter.js";
import type { ClodFrameLoopUiState } from "./ui_state.js";

function baseUnderstoryStats(before: number, after: number): UnderstoryStats {
  return {
    ...emptyUnderstoryStats(),
    totalInstances: 64,
    gpuStatus: "ring",
    gpuCandidateCount: after,
    gpuCandidateCountBeforePrefilter: before,
    gpuCandidateCountAfterPrefilter: after,
    gpuAcceptedCount: 64,
    gpuVisibleCount: 64,
  };
}

function baseForestLightingStats(): ForestLightingStats {
  return {
    enabled: false,
    textureUpdates: 0,
    treeProxies: 0,
    understoryProxies: 0,
    maxCanopy: 0,
    maxAo: 0,
    maxShadow: 0,
    maxFog: 0,
  };
}

function baseUiState(): ClodFrameLoopUiState {
  return {
    freeze: false,
    bubble: false,
    bubbleRadius: 0,
    digEnabled: false,
    brushShape: "sphere",
    brushOp: "subtract",
    digRadius: 0,
    brushHeight: 0,
    weatherMode: "clear",
    waterEnabled: true,
    profileEnabled: false,
    grassBladeCount: 0,
    grassVisiblePatches: "",
    grassTierSummary: "",
    grassEdgeSuppressed: 0,
    grassCandidateCount: 0,
    treeTotal: "0" as unknown as ClodFrameLoopUiState["treeTotal"],
    treeVisiblePatches: "",
    treeLodSummary: "",
    treeGpuSummary: "",
    stoneTotal: 0,
    stoneClassSummary: "",
    stoneVisible: 0,
    understoryTotal: 0,
    understoryVisiblePatches: "",
    understoryClassSummary: "",
    understoryGpuSummary: "",
    forestLightingStats: "",
  };
}

function basePresenter(updateDisplay: () => void): StatsPresenter {
  return {
    grassBladeCountController: null,
    grassVisiblePatchesController: null,
    grassTierSummaryController: null,
    grassEdgeSuppressedController: null,
    grassCandidateCountController: null,
    treeTotalController: null,
    treeVisiblePatchesController: null,
    treeLodSummaryController: null,
    treeGpuSummaryController: null,
    stoneTotalController: null,
    stoneClassSummaryController: null,
    stoneVisibleController: null,
    understoryTotalController: null,
    understoryVisiblePatchesController: null,
    understoryClassSummaryController: null,
    understoryGpuSummaryController: { updateDisplay },
    forestLightingStatsController: null,
  };
}

describe("runStatsSyncPhase", () => {
  it("refreshes understory GPU summary when only prefilter budget changes", () => {
    const state = baseUiState();
    const updateDisplay = vi.fn();
    const previous = baseUnderstoryStats(1024, 256);
    const next = baseUnderstoryStats(1536, 256);
    let storedUnderstory: UnderstoryStats | null = previous;

    runStatsSyncPhase({
      state,
      grassSystem: null,
      treeSystem: null,
      stoneSystem: null,
      understorySystem: { getStats: () => next },
      forestLightingSystem: { getStats: baseForestLightingStats },
      getGrassStats: () => null,
      setGrassStats: () => {},
      getTreeStats: () => null,
      setTreeStats: () => {},
      getStoneStats: () => null,
      setStoneStats: () => {},
      getUnderstoryStats: () => storedUnderstory,
      setUnderstoryStats: (stats) => { storedUnderstory = stats; },
      getForestLightingStats: () => baseForestLightingStats(),
      setForestLightingStats: () => {},
      formatTreeGpuSummary: () => "",
      formatUnderstoryGpuSummary: (stats) => `prefilter=${stats.gpuCandidateCountAfterPrefilter}/${stats.gpuCandidateCountBeforePrefilter}`,
      statsPresenter: basePresenter(updateDisplay),
    });

    expect(storedUnderstory).toBe(next);
    expect(state.understoryGpuSummary).toBe("prefilter=256/1536");
    expect(updateDisplay).toHaveBeenCalledTimes(1);
  });
});
