import type { StreamingOwnershipRadii } from "../streaming/streaming_ownership.js";
import { LiveVoxelChunkStreamer, type LiveVoxelChunkStreamerConfig, type LiveVoxelChunkStreamerSnapshot } from "./live_voxel_chunk_streamer.js";
import type { StreamCenter } from "./live_chunk_keys.js";
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
  private center: StreamCenter = { x: 0, z: 0 };

  constructor(
    private readonly ownership: StreamingOwnershipRadii,
    config: TerrainOwnershipRuntimeConfig,
  ) {
    this.live = new LiveVoxelChunkStreamer(ownership, config.live);
    this.visualPages = new VisualClodPageStreamer(ownership.liveRadiusM, ownership.clodRadiusM, config.visualPages);
  }

  update(center: StreamCenter): TerrainOwnershipRuntimeSnapshot {
    this.center = { ...center };
    return this.buildSnapshot(true);
  }

  snapshot(): TerrainOwnershipRuntimeSnapshot {
    return this.buildSnapshot(false);
  }

  private buildSnapshot(update: boolean): TerrainOwnershipRuntimeSnapshot {
    return {
      center: { ...this.center },
      live: update ? this.live.update(this.center) : this.live.snapshot(),
      visualPages: update ? this.visualPages.update(this.center.x, this.center.z) : this.visualPages.snapshot(),
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
