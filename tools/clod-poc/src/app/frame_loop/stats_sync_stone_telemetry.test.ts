import { describe, expect, it, vi } from "vitest";
import type { ForestLightingStats } from "../../forest_lighting/index.js";
import type { StoneStats } from "../../stones/stone_instances.js";
import { runStatsSyncPhase } from "./stats_sync_phase.js";
import type { ClodFrameLoopUiState } from "./ui_state.js";

const FOREST_STATS: ForestLightingStats = {
  enabled: false,
  resolution: 0,
  treeProxies: 0,
  understoryProxies: 0,
  maxCanopy: 0,
  maxAo: 0,
  maxShadow: 0,
  maxFog: 0,
  updateMs: 0,
  textureUpdates: 0,
};

function stoneStats(overrides: Partial<StoneStats> = {}): StoneStats {
  return {
    total: 9,
    large: 1,
    medium: 3,
    small: 5,
    visible: 9,
    drawnNear: 9,
    drawnFar: 0,
    groups: 3,
    gpuTelemetryState: "unknown",
    ...overrides,
  };
}

function run(next: StoneStats) {
  const state = {
    stoneTotal: 0,
    stoneClassSummary: "",
    stoneVisible: 0,
  } as unknown as ClodFrameLoopUiState;
  let current: StoneStats | null = null;
  const updateDisplay = vi.fn();

  runStatsSyncPhase({
    state,
    grassSystem: null,
    treeSystem: null,
    stoneSystem: { getStats: () => next },
    understorySystem: null,
    forestLightingSystem: { getStats: () => FOREST_STATS },
    getGrassStats: () => null,
    setGrassStats: () => {},
    getTreeStats: () => null,
    setTreeStats: () => {},
    getStoneStats: () => current,
    setStoneStats: (stats) => { current = stats; },
    getUnderstoryStats: () => null,
    setUnderstoryStats: () => {},
    getForestLightingStats: () => FOREST_STATS,
    setForestLightingStats: () => {},
    formatTreeGpuSummary: () => "",
    formatUnderstoryGpuSummary: () => "",
    statsPresenter: {
      grassBladeCountController: null,
      grassVisiblePatchesController: null,
      grassTierSummaryController: null,
      grassEdgeSuppressedController: null,
      grassCandidateCountController: null,
      treeTotalController: null,
      treeVisiblePatchesController: null,
      treeLodSummaryController: null,
      treeGpuSummaryController: null,
      stoneTotalController: { updateDisplay },
      stoneClassSummaryController: { updateDisplay },
      stoneVisibleController: { updateDisplay },
      understoryTotalController: null,
      understoryVisiblePatchesController: null,
      understoryClassSummaryController: null,
      understoryGpuSummaryController: null,
      forestLightingStatsController: null,
    },
  });

  return { state, current, updateDisplay };
}

describe("stone telemetry presentation", () => {
  it("does not present zero as an authoritative GPU count when readbacks are off", () => {
    const result = run(stoneStats({ total: 0, visible: 0, large: 0, medium: 0, small: 0 }));

    expect(result.state.stoneTotal).toBe(-1);
    expect(result.state.stoneVisible).toBe(-1);
    expect(result.state.stoneClassSummary).toContain("counts unknown");
    expect(result.current?.gpuTelemetryState).toBe("unknown");
  });

  it("shows last-known counts and separated timing labels when available", () => {
    const result = run(stoneStats({
      gpuTelemetryState: "last-known",
      gpuTimingSupported: true,
      gpuWorldMs: 0.42,
      gpuViewMs: null,
      gpuIndirectMs: 0.03,
    }));

    expect(result.state.stoneTotal).toBe(9);
    expect(result.state.stoneVisible).toBe(9);
    expect(result.state.stoneClassSummary).toContain("1/3/5");
    expect(result.state.stoneClassSummary).toContain("telemetry=last-known");
    expect(result.state.stoneClassSummary).toContain("world=0.420ms");
    expect(result.state.stoneClassSummary).toContain("view=fused");
    expect(result.updateDisplay).toHaveBeenCalledTimes(3);
  });
});
