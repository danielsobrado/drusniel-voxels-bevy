import type { ChunkSummary, ViewportSnapshot, WorldViewportPreview } from "../../types/world";
import { LITE_VOXEL_VIEWPORT_CONTRACT } from "./viewportArchitecture";

export interface LiteVoxelViewportProps {
  readonly chunks: readonly ChunkSummary[];
  readonly worldViewport: WorldViewportPreview | null;
  readonly viewportSnapshot: ViewportSnapshot | null;
}

export const LiteVoxelViewport = Object.assign(
  function LiteVoxelViewport(_props: LiteVoxelViewportProps) {
    return null;
  },
  { contract: LITE_VOXEL_VIEWPORT_CONTRACT },
);
