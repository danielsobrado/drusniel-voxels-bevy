import type { RenderQualityPreset } from "../types/editor";
import type { RuntimeMetrics } from "../types/runtime";
import type { WaterReflectionDebugViewMode } from "../types/world";

export interface RuntimeSnapshot {
  readonly metrics: RuntimeMetrics;
  readonly status: "mocked" | "offline";
}

export interface RuntimeClient {
  readonly getRuntimeSnapshot: () => Promise<RuntimeSnapshot>;
  readonly setRenderQuality: (preset: RenderQualityPreset) => Promise<RuntimeSnapshot>;
  readonly rebuildSelectedChunk: (chunkId: string) => Promise<{ readonly queuedChunkId: string }>;
  readonly rebuildDirtyChunks: (chunkIds: readonly string[]) => Promise<{ readonly queuedChunkIds: readonly string[] }>;
  readonly setWaterReflectionDebugMode: (waterBodyId: string, mode: WaterReflectionDebugViewMode) => Promise<{ readonly waterBodyId: string; readonly mode: WaterReflectionDebugViewMode }>;
  readonly runWaterVisualProbe: () => Promise<{ readonly probeValid: true; readonly lastProbeUpdateMs: number }>;
}
