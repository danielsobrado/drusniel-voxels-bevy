import { formatTreeTotalDisplay } from "../../trees/index.js";
import type { GrassStats } from "../../grass.js";
import type { StoneStats } from "../../stones/stone_instances.js";
import type { TreeStats } from "../../trees/index.js";
import type { UnderstoryStats } from "../../understory/index.js";
import type { ForestLightingStats } from "../../forest_lighting/index.js";
import type { ClodFrameLoopUiState } from "./ui_state.js";
import { submitMsChanged } from "./frame_timing.js";
import type { StatsPresenter } from "./stats_presenter.js";

export interface StatsSyncPhaseInput {
  state: ClodFrameLoopUiState;
  grassSystem: { getStats: () => GrassStats | null } | null;
  treeSystem: { getStats: () => TreeStats | null } | null;
  stoneSystem: { getStats: () => StoneStats | null } | null;
  understorySystem: { getStats: () => UnderstoryStats | null } | null;
  forestLightingSystem: { getStats: () => ForestLightingStats };
  getGrassStats: () => GrassStats | null;
  setGrassStats: (stats: GrassStats | null) => void;
  getTreeStats: () => TreeStats | null;
  setTreeStats: (stats: TreeStats | null) => void;
  getStoneStats: () => StoneStats | null;
  setStoneStats: (stats: StoneStats | null) => void;
  getUnderstoryStats: () => UnderstoryStats | null;
  setUnderstoryStats: (stats: UnderstoryStats | null) => void;
  getForestLightingStats: () => ForestLightingStats | null;
  setForestLightingStats: (stats: ForestLightingStats | null) => void;
  formatTreeGpuSummary: (stats: TreeStats) => string;
  formatUnderstoryGpuSummary: (stats: UnderstoryStats) => string;
  statsPresenter: StatsPresenter;
}

export interface StatsSyncPhaseResult {
  currentGrassStats: GrassStats | null;
}

export function runStatsSyncPhase(input: StatsSyncPhaseInput): StatsSyncPhaseResult {
  const presenter = input.statsPresenter;
  const nextTreeStats = input.treeSystem?.getStats();
  const treeStats = input.getTreeStats();
  if (
    nextTreeStats && (
    !treeStats ||
    nextTreeStats.totalTrees !== treeStats.totalTrees ||
    nextTreeStats.visiblePatches !== treeStats.visiblePatches ||
    nextTreeStats.patches !== treeStats.patches ||
    nextTreeStats.nearTrees !== treeStats.nearTrees ||
    nextTreeStats.midTrees !== treeStats.midTrees ||
    nextTreeStats.farTrees !== treeStats.farTrees ||
    nextTreeStats.impostorTrees !== treeStats.impostorTrees ||
    nextTreeStats.gpuStatus !== treeStats.gpuStatus ||
    nextTreeStats.gpuCandidateCount !== treeStats.gpuCandidateCount ||
    nextTreeStats.gpuAcceptedCount !== treeStats.gpuAcceptedCount ||
    nextTreeStats.gpuVisibleCount !== treeStats.gpuVisibleCount ||
    nextTreeStats.gpuOverflowed !== treeStats.gpuOverflowed)
  ) {
    input.setTreeStats(nextTreeStats);
    input.state.treeTotal = formatTreeTotalDisplay(nextTreeStats);
    input.state.treeVisiblePatches = `${nextTreeStats.visiblePatches}/${nextTreeStats.patches}`;
    input.state.treeLodSummary = `${nextTreeStats.nearTrees}/${nextTreeStats.midTrees}/${nextTreeStats.farTrees}/${nextTreeStats.impostorTrees}`;
    input.state.treeGpuSummary = input.formatTreeGpuSummary(nextTreeStats);
    presenter.treeTotalController?.updateDisplay();
    presenter.treeVisiblePatchesController?.updateDisplay();
    presenter.treeLodSummaryController?.updateDisplay();
    presenter.treeGpuSummaryController?.updateDisplay();
  }

  const nextStoneStats = input.stoneSystem?.getStats();
  const stoneStats = input.getStoneStats();
  if (nextStoneStats && (!stoneStats || nextStoneStats.total !== stoneStats.total || nextStoneStats.visible !== stoneStats.visible)) {
    input.setStoneStats(nextStoneStats);
    input.state.stoneTotal = nextStoneStats.total;
    input.state.stoneClassSummary = `${nextStoneStats.large}/${nextStoneStats.medium}/${nextStoneStats.small}`;
    input.state.stoneVisible = nextStoneStats.visible;
    presenter.stoneTotalController?.updateDisplay();
    presenter.stoneClassSummaryController?.updateDisplay();
    presenter.stoneVisibleController?.updateDisplay();
  }

  const nextUnderstoryStats = input.understorySystem?.getStats();
  const understoryStats = input.getUnderstoryStats();
  if (
    nextUnderstoryStats && (
    !understoryStats ||
    nextUnderstoryStats.totalInstances !== understoryStats.totalInstances ||
    nextUnderstoryStats.visiblePatches !== understoryStats.visiblePatches ||
    nextUnderstoryStats.patches !== understoryStats.patches ||
    nextUnderstoryStats.gpuStatus !== understoryStats.gpuStatus ||
    nextUnderstoryStats.gpuVisibleCount !== understoryStats.gpuVisibleCount ||
    nextUnderstoryStats.gpuCandidateCount !== understoryStats.gpuCandidateCount ||
    nextUnderstoryStats.gpuAcceptedCount !== understoryStats.gpuAcceptedCount ||
    nextUnderstoryStats.gpuOverflowed !== understoryStats.gpuOverflowed ||
    submitMsChanged(nextUnderstoryStats.gpuDispatchMs, understoryStats.gpuDispatchMs))
  ) {
    input.setUnderstoryStats(nextUnderstoryStats);
    input.state.understoryTotal = nextUnderstoryStats.totalInstances;
    input.state.understoryVisiblePatches = `${nextUnderstoryStats.visiblePatches}/${nextUnderstoryStats.patches}`;
    input.state.understoryClassSummary =
      `${nextUnderstoryStats.shrub}/${nextUnderstoryStats.fern}/${nextUnderstoryStats.sapling}/${nextUnderstoryStats.flower}/${nextUnderstoryStats.deadLog}/${nextUnderstoryStats.stump}`;
    input.state.understoryGpuSummary = input.formatUnderstoryGpuSummary(nextUnderstoryStats);
    presenter.understoryTotalController?.updateDisplay();
    presenter.understoryVisiblePatchesController?.updateDisplay();
    presenter.understoryClassSummaryController?.updateDisplay();
    presenter.understoryGpuSummaryController?.updateDisplay();
  }

  const nextForestLightingStats = input.forestLightingSystem.getStats();
  const forestLightingStats = input.getForestLightingStats();
  if (
    !forestLightingStats ||
    nextForestLightingStats.textureUpdates !== forestLightingStats.textureUpdates ||
    nextForestLightingStats.enabled !== forestLightingStats.enabled ||
    nextForestLightingStats.treeProxies !== forestLightingStats.treeProxies ||
    nextForestLightingStats.understoryProxies !== forestLightingStats.understoryProxies
  ) {
    input.setForestLightingStats(nextForestLightingStats);
    input.state.forestLightingStats = nextForestLightingStats.enabled
      ? `canopy=${nextForestLightingStats.maxCanopy.toFixed(2)} ao=${nextForestLightingStats.maxAo.toFixed(2)} ` +
        `shadow=${nextForestLightingStats.maxShadow.toFixed(2)} fog=${nextForestLightingStats.maxFog.toFixed(2)}`
      : "disabled";
    presenter.forestLightingStatsController?.updateDisplay();
  }

  const nextGrassStats = input.grassSystem?.getStats();
  const grassStats = input.getGrassStats();
  if (
    nextGrassStats && (
    !grassStats ||
    nextGrassStats.blades !== grassStats.blades ||
    nextGrassStats.visiblePatches !== grassStats.visiblePatches ||
    nextGrassStats.patches !== grassStats.patches ||
    nextGrassStats.nearPatches !== grassStats.nearPatches ||
    nextGrassStats.midPatches !== grassStats.midPatches ||
    nextGrassStats.coveragePatches !== grassStats.coveragePatches ||
    nextGrassStats.superPatches !== grassStats.superPatches ||
    nextGrassStats.gpuRingStatus !== grassStats.gpuRingStatus ||
    nextGrassStats.gpuRingVisibleNear !== grassStats.gpuRingVisibleNear ||
    nextGrassStats.gpuRingVisibleMid !== grassStats.gpuRingVisibleMid ||
    nextGrassStats.gpuRingVisibleFar !== grassStats.gpuRingVisibleFar ||
    nextGrassStats.gpuRingVisibleSuper !== grassStats.gpuRingVisibleSuper ||
    nextGrassStats.edgeSuppressedCandidates !== grassStats.edgeSuppressedCandidates ||
    nextGrassStats.generatedCandidates !== grassStats.generatedCandidates)
  ) {
    input.setGrassStats(nextGrassStats);
    input.state.grassBladeCount = nextGrassStats.blades;
    input.state.grassVisiblePatches = `${nextGrassStats.visiblePatches}/${nextGrassStats.patches}`;
    input.state.grassTierSummary = `${nextGrassStats.nearPatches}/${nextGrassStats.midPatches}/${nextGrassStats.coveragePatches}/${nextGrassStats.superPatches}`;
    input.state.grassEdgeSuppressed = nextGrassStats.edgeSuppressedCandidates;
    input.state.grassCandidateCount = nextGrassStats.generatedCandidates;
    presenter.grassBladeCountController?.updateDisplay();
    presenter.grassVisiblePatchesController?.updateDisplay();
    presenter.grassTierSummaryController?.updateDisplay();
    presenter.grassEdgeSuppressedController?.updateDisplay();
    presenter.grassCandidateCountController?.updateDisplay();
  }

  return { currentGrassStats: nextGrassStats ?? grassStats };
}
