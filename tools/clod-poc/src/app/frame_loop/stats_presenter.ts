export interface GuiDisplayController {
  updateDisplay: () => unknown;
}

export interface StatsPresenter {
  grassBladeCountController: GuiDisplayController | null;
  grassVisiblePatchesController: GuiDisplayController | null;
  grassTierSummaryController: GuiDisplayController | null;
  grassEdgeSuppressedController: GuiDisplayController | null;
  grassCandidateCountController: GuiDisplayController | null;
  treeTotalController: GuiDisplayController | null;
  treeVisiblePatchesController: GuiDisplayController | null;
  treeLodSummaryController: GuiDisplayController | null;
  treeGpuSummaryController: GuiDisplayController | null;
  stoneTotalController: GuiDisplayController | null;
  stoneClassSummaryController: GuiDisplayController | null;
  stoneVisibleController: GuiDisplayController | null;
  understoryTotalController: GuiDisplayController | null;
  understoryVisiblePatchesController: GuiDisplayController | null;
  understoryClassSummaryController: GuiDisplayController | null;
  understoryGpuSummaryController: GuiDisplayController | null;
  forestLightingStatsController: GuiDisplayController | null;
}
