import type { BrushOp, BrushShape } from "../../terrain.js";
import type { TreeTotalDisplay } from "../../trees/tree_info.js";

export interface ClodFrameLoopUiState {
  freeze: boolean;
  bubble: boolean;
  bubbleRadius: number;
  digEnabled: boolean;
  brushShape: BrushShape;
  brushOp: BrushOp;
  digRadius: number;
  brushHeight: number;
  weatherMode: string;
  profileEnabled: boolean;
  grassBladeCount: number;
  grassVisiblePatches: string;
  grassTierSummary: string;
  grassEdgeSuppressed: number;
  grassCandidateCount: number;
  treeTotal: TreeTotalDisplay;
  treeVisiblePatches: string;
  treeLodSummary: string;
  treeGpuSummary: string;
  stoneTotal: number;
  stoneClassSummary: string;
  stoneVisible: number;
  understoryTotal: number;
  understoryVisiblePatches: string;
  understoryClassSummary: string;
  understoryGpuSummary: string;
  forestLightingStats: string;
}
