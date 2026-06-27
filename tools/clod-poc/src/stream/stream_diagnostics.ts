import type { ClodPagesConfig } from "../config.js";
import type { Phase0Config } from "../phase0/phase0_config.js";
import { resolveStreamingOwnership, type StreamingOwnershipRadii } from "../streaming/streaming_ownership.js";
import { TerrainOwnershipRuntime, type TerrainOwnershipRuntimeSnapshot } from "./terrain_ownership_runtime.js";

export interface StreamDiagnosticInput {
  cfg: ClodPagesConfig;
  maxTerrainLevel: number;
  phase0Config: Phase0Config;
  phase0TargetVisibleM: number;
  queryScene: string | null;
}

export interface StreamDiagnosticSnapshot extends Omit<TerrainOwnershipRuntimeSnapshot, "ownership"> {
  ownership: StreamingOwnershipRadii;
}

export interface StreamDiagnosticTracker {
  update(center: { x: number; z: number }): StreamDiagnosticSnapshot;
  snapshot(): StreamDiagnosticSnapshot;
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
  const runtime = new TerrainOwnershipRuntime(ownership, {
    live: {
      chunkSizeM: input.cfg.page.chunk_size,
      hysteresisM: input.cfg.page.chunk_size * 2,
    },
    visualPages: {
      pageSizeM,
      maxLevel: input.maxTerrainLevel,
      hysteresisM: pageSizeM,
    },
  });

  const withOwnership = (snapshot: TerrainOwnershipRuntimeSnapshot): StreamDiagnosticSnapshot => ({
    ...snapshot,
    ownership,
  });

  return {
    update(center) {
      return withOwnership(runtime.update(center));
    },
    snapshot() {
      return withOwnership(runtime.snapshot());
    },
    format(snapshot) {
      return `stream ownership: live<=${snapshot.ownership.liveRadiusM}m chunks req/load/evict=${snapshot.live.required.length}/${snapshot.live.loaded.length}/${snapshot.live.evictable.length}  ` +
        `clod<=${snapshot.ownership.clodRadiusM}m pages req/load/evict=${snapshot.visualPages.required.length}/${snapshot.visualPages.loaded.length}/${snapshot.visualPages.evictable.length}  ` +
        `far-shell>=${snapshot.farShell.innerRadiusM}m`;
    },
  };
}
