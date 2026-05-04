import type { RuntimeClient } from "./RuntimeClient";
import { mockRuntimeMetrics } from "../mocks/mockRuntime";
import type { RenderQualityPreset } from "../types/editor";
import type { WaterReflectionDebugViewMode } from "../types/world";

export class MockRuntimeClient implements RuntimeClient {
  async getRuntimeSnapshot() {
    return { metrics: mockRuntimeMetrics, status: "mocked" as const };
  }

  async setRenderQuality(preset: RenderQualityPreset) {
    return { metrics: { ...mockRuntimeMetrics, renderQualityPreset: preset }, status: "mocked" as const };
  }

  async rebuildSelectedChunk(chunkId: string) {
    return { queuedChunkId: chunkId };
  }

  async rebuildDirtyChunks(chunkIds: readonly string[]) {
    return { queuedChunkIds: chunkIds };
  }

  async setWaterReflectionDebugMode(waterBodyId: string, mode: WaterReflectionDebugViewMode) {
    return { waterBodyId, mode };
  }

  async runWaterVisualProbe() {
    return { probeValid: true as const, lastProbeUpdateMs: 1.4 };
  }
}
