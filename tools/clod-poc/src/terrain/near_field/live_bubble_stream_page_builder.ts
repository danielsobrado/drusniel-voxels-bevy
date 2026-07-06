import type { ClodPageNode } from "../../types.js";

export interface LiveBubbleStreamPageBuildRequest {
  px: number;
  pz: number;
  level?: number;
}

export interface LiveBubbleStreamPageBuildResult {
  nodes: ClodPageNode[];
}

export type LiveBubbleStreamPageBuilder = (
  coords: readonly LiveBubbleStreamPageBuildRequest[],
) => Promise<LiveBubbleStreamPageBuildResult>;
