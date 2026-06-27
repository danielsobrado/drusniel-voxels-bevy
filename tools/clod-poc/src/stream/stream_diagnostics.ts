import type { ClodPagesConfig } from "../config.js";
import type { Phase0Config } from "../phase0/phase0_config.js";
import { resolveStreamingOwnership, type StreamingOwnershipRadii } from "../streaming/streaming_ownership.js";
import { LiveVoxelChunkStreamer, type LiveVoxelChunkStreamerSnapshot } from "./live_voxel_chunk_streamer.js";
import { VisualClodPageStreamer, type VisualPageStreamerSnapshot } from "./page_plan.js";

export interface StreamDiagnosticInput {
  cfg: ClodPagesConfig;
  maxTerrainLevel: number;
  phase0Config: Phase0Config;
  phase0TargetVisibleM: number;
  queryScene: string | null;
}

export interface StreamDiagnosticSnapshot {
  ownership: StreamingOwnershipRadii;
  live: LiveVoxelChunkStreamerSnapshot;
  clod: VisualPageStreamerSnapshot;
}

export interface StreamDiagnosticTracker {
  update(center: { x: number; z: number }): StreamDiagnosticSnapshot;
  format(snapshot: StreamDiagnosticSnapshot): string;
}

export function createStreamDiagnosticTracker(input: StreamDiagnosticInput): StreamDiagnosticTracker {
  const pageSizeM = input.cfg.page.chunks_per_page * input.cfg.page.chunk_size;
  const ownership = resolveStreamingOwnership({
    streaming: input.phase0Config.phase0.streaming,
    targetVisibleM: input.phase0TargetVisibleM,
    targetFutureVisibleM: input.phase0Config.phase0.target_future_visible_m,
    streamingScene: input.queryScene?.startsWith("infinite-") ?? false,
  });
  const live = new LiveVoxelChunkStreamer(ownership, {
    chunkSizeM: input.cfg.page.chunk_size,
    hysteresisM: input.cfg.page.chunk_size * 2,
  });
  const clod = new VisualClodPageStreamer(ownership.liveRadiusM, ownership.clodRadiusM, {
    pageSizeM,
    maxLevel: input.maxTerrainLevel,
    hysteresisM: pageSizeM,
  });

  return {
    update(center) {
      return {
        ownership,
        live: live.update(center),
        clod: clod.update(center.x, center.z),
      };
    },
    format(snapshot) {
      return `stream ownership: live<=${snapshot.ownership.liveRadiusM}m chunks req/load/evict=${snapshot.live.required.length}/${snapshot.live.loaded.length}/${snapshot.live.evictable.length}  ` +
        `clod<=${snapshot.ownership.clodRadiusM}m pages req/load/evict=${snapshot.clod.required.length}/${snapshot.clod.loaded.length}/${snapshot.clod.evictable.length}  ` +
        `far-shell>=${snapshot.ownership.farShellInnerM}m`;
    },
  };
}
