import type { RenderQualityPreset } from "../types/editor";
import type { RuntimeMetrics } from "../types/runtime";
import type { MockWaterRuntimeSnapshot, WaterReflectionDebugViewMode, WaterReflectionStatus } from "../types/world";

export type RuntimeCommandResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: string; readonly code?: string };

export interface RuntimeSnapshot {
  readonly metrics: RuntimeMetrics;
  readonly status: "mocked" | "offline";
}

export interface RuntimeClient {
  readonly getRuntimeSnapshot: () => Promise<RuntimeCommandResult<RuntimeSnapshot>>;
  readonly getRenderQuality: () => Promise<RuntimeCommandResult<RenderQualityPreset>>;
  readonly setRenderQuality: (preset: RenderQualityPreset) => Promise<RuntimeCommandResult<RuntimeSnapshot>>;
  readonly getWaterReflectionStatus: () => Promise<RuntimeCommandResult<WaterReflectionStatus>>;
  readonly setWaterReflectionDebugMode: (waterBodyId: string, mode: WaterReflectionDebugViewMode) => Promise<RuntimeCommandResult<{ readonly waterBodyId: string; readonly mode: WaterReflectionDebugViewMode }>>;
  readonly runWaterVisualProbe: () => Promise<RuntimeCommandResult<MockWaterRuntimeSnapshot>>;
  readonly rebuildSelectedChunk: (chunkId: string) => Promise<RuntimeCommandResult<{ readonly queuedChunkId: string }>>;
  readonly rebuildDirtyChunks: (chunkIds: readonly string[]) => Promise<RuntimeCommandResult<{ readonly queuedChunkIds: readonly string[] }>>;
}
