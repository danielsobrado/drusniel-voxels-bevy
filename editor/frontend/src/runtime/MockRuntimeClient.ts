import type { RuntimeClient, RuntimeCommandResult, RuntimeSnapshot } from "./RuntimeClient";
import { mockRuntimeMetrics } from "../mocks/mockRuntime";
import type { RenderQualityPreset } from "../types/editor";
import type { MockWaterRuntimeSnapshot, WaterReflectionDebugViewMode, WaterReflectionStatus } from "../types/world";
import { mockWaterRuntimeSnapshot } from "../mocks/mockRuntime";

export class MockRuntimeClient implements RuntimeClient {
  async getRuntimeSnapshot(): Promise<RuntimeCommandResult<RuntimeSnapshot>> {
    return { ok: true, data: { metrics: mockRuntimeMetrics, status: "mocked" } };
  }

  async getRenderQuality(): Promise<RuntimeCommandResult<RenderQualityPreset>> {
    return { ok: true, data: mockRuntimeMetrics.renderQualityPreset };
  }

  async setRenderQuality(preset: RenderQualityPreset): Promise<RuntimeCommandResult<RuntimeSnapshot>> {
    return { ok: true, data: { metrics: { ...mockRuntimeMetrics, renderQualityPreset: preset }, status: "mocked" } };
  }

  async getWaterReflectionStatus(): Promise<RuntimeCommandResult<WaterReflectionStatus>> {
    return { ok: true, data: mockWaterRuntimeSnapshot.reflectionStatus };
  }

  async setWaterReflectionDebugMode(waterBodyId: string, mode: WaterReflectionDebugViewMode) {
    return { ok: true as const, data: { waterBodyId, mode } };
  }

  async runWaterVisualProbe() {
    const snapshot: MockWaterRuntimeSnapshot = {
      ...mockWaterRuntimeSnapshot,
      reflectionStatus: { ...mockWaterRuntimeSnapshot.reflectionStatus, lastProbeUpdateMs: 3.1 },
      waterPresence: { ...mockWaterRuntimeSnapshot.waterPresence, nearestWaterDistance: 4.2 },
    };

    return { ok: true as const, data: snapshot };
  }

  async rebuildSelectedChunk(chunkId: string) {
    return { ok: true as const, data: { queuedChunkId: chunkId } };
  }

  async rebuildDirtyChunks(chunkIds: readonly string[]) {
    return { ok: true as const, data: { queuedChunkIds: chunkIds } };
  }
}
