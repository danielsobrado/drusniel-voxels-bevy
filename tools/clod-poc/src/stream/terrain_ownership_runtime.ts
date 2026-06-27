import type { StreamingOwnershipRadii } from "../streaming/streaming_ownership.js";
import { LiveVoxelChunkStreamer, type LiveVoxelChunkStreamerConfig, type LiveVoxelChunkStreamerSnapshot, type StreamCenter } from "./live_voxel_chunk_streamer.js";
import { VisualClodPageStreamer, type VisualPageStreamerConfig, type VisualPageStreamerSnapshot } from "./page_plan.js";

export interface TerrainOwnershipRuntimeConfig {
  live: LiveVoxelChunkStreamerConfig;
  visualPages: VisualPageStreamerConfig;
}

export interface TerrainOwnershipRuntimeSnapshot {
  center: StreamCenter;
  live: LiveVoxelChunkStreamerSnapshot;
  visualPages: VisualPageStreamerSnapshot;
  ownership: {
    liveRadiusM: number;
    clodRadiusM: number;
  };
  farShell: {
    innerRadiusM: number;
    outerRadiusM: number;
  };
}

export class TerrainOwnershipRuntime {
  private readonly live: LiveVoxelChunkStreamer;
  private readonly visualPages: VisualClodPageStreamer;

  constructor(
    private readonly ownership: StreamingOwnershipRadii,
    config: TerrainOwnershipRuntimeConfig,
  ) {
    this.live = new LiveVoxelChunkStreamer(ownership, config.live);
    this.visualPages = new VisualClodPageStreamer(ownership.liveRadiusM, ownership.clodRadiusM, config.visualPages);
  }

  update(center: StreamCenter): TerrainOwnershipRuntimeSnapshot {
    return {
      center: { ...center },
      live: this.live.update(center),
      visualPages: this.visualPages.update(center.x, center.z),
      ownership: {
        liveRadiusM: this.ownership.liveRadiusM,
        clodRadiusM: this.ownership.clodRadiusM,
      },
      farShell: {
        innerRadiusM: this.ownership.farShellInnerM,
        outerRadiusM: this.ownership.farShellOuterM,
      },
    };
  }
}
