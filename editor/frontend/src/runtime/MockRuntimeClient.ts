import { getMockRenderQualityReadouts, mockRuntimeMetrics, mockWaterRuntimeSnapshot } from "../mocks/mockRuntime";
import { mockAtlasMapping, mockChunks, mockProps } from "../mocks/mockWorld";
import type { RenderQualityPreset, Selection } from "../types/editor";
import type { BlockAtlasMap, ProtectedArea, WaterReflectionDebugViewMode, WaterReflectionStatus } from "../types/world";
import type { RuntimeClient } from "./RuntimeClient";
import type { RuntimeEventHandler } from "./runtimeEvents";
import type { RuntimeConnectionState, RuntimeSnapshot } from "./runtimeSchemas";
import { runtimeCommandSuccess } from "./runtimeSchemas";

const mockCapabilities = {
  canSelectEntity: true,
  canFocusCamera: true,
  canRebuildChunks: true,
  canSetRenderQuality: true,
  canDebugWaterReflections: true,
  canRunWaterVisualProbe: true,
  canEditAtlasMapping: true,
  canEditProtectedAreas: true,
  canSaveWorldSnapshot: true,
};

const mockPropStats = () => ({
  totalInstances: mockProps.length,
  visibleInstances: mockProps.filter((prop) => prop.visible).length,
  hiddenInstances: mockProps.filter((prop) => !prop.visible).length,
  billboardedCount: mockProps.filter((prop) => prop.billboardEnabled).length,
  threeDCount: mockProps.filter((prop) => !prop.billboardEnabled).length,
  lodSwitches: mockProps.filter((prop) => prop.currentLod !== prop.lodState).length,
  missingGeneratedAssets: mockProps.filter((prop) => !prop.generatedAssetAvailable).length,
  boundsWarnings: mockProps.filter((prop) => prop.boundsWarning).length,
  instancedGroups: new Set(mockProps.map((prop) => prop.type)).size,
  shadowCastCount: mockProps.filter((prop) => prop.shadowCast).length,
});

export class MockRuntimeClient implements RuntimeClient {
  private renderQualityPreset: RenderQualityPreset = mockRuntimeMetrics.renderQualityPreset;
  private atlasMapping: BlockAtlasMap = { ...mockAtlasMapping };
  private connectionState: RuntimeConnectionState = "mock";
  private readonly handlers = new Set<RuntimeEventHandler>();

  getConnectionState(): RuntimeConnectionState {
    return this.connectionState;
  }

  async getRuntimeSnapshot() {
    return runtimeCommandSuccess(this.createSnapshot());
  }

  async getRenderQuality() {
    return runtimeCommandSuccess({
      preset: this.renderQualityPreset,
      metrics: getMockRenderQualityReadouts(this.renderQualityPreset),
    });
  }

  async setRenderQuality(preset: RenderQualityPreset) {
    this.renderQualityPreset = preset;
    return runtimeCommandSuccess({
      preset: this.renderQualityPreset,
      metrics: getMockRenderQualityReadouts(this.renderQualityPreset),
    });
  }

  async getWaterReflectionStatus() {
    return runtimeCommandSuccess(mockWaterRuntimeSnapshot.reflectionStatus);
  }

  async selectEntity(selection: Selection) {
    return runtimeCommandSuccess({ selection });
  }

  async focusCamera(target: Selection | readonly [number, number, number]) {
    return runtimeCommandSuccess({ target });
  }

  async setWaterReflectionDebugMode(waterBodyId: string, mode: WaterReflectionDebugViewMode) {
    return runtimeCommandSuccess({ waterBodyId, mode });
  }

  async runWaterVisualProbe() {
    return runtimeCommandSuccess({
      ...mockWaterRuntimeSnapshot,
      reflectionStatus: { ...mockWaterRuntimeSnapshot.reflectionStatus, lastProbeUpdateMs: 3.1 },
      waterPresence: { ...mockWaterRuntimeSnapshot.waterPresence, nearestWaterDistance: 4.2 },
      capturedAt: new Date().toISOString(),
    });
  }

  async rebuildSelectedChunk(chunkId: string) {
    return runtimeCommandSuccess({ queuedChunkIds: [chunkId] });
  }

  async rebuildDirtyChunks(chunkIds: readonly string[]) {
    return runtimeCommandSuccess({ queuedChunkIds: chunkIds });
  }

  async setAtlasMapping(mapping: BlockAtlasMap) {
    this.atlasMapping = { ...mapping };
    return runtimeCommandSuccess({
      mapping: this.atlasMapping,
      dirty: true,
    });
  }

  async saveAtlasMapping(mapping: BlockAtlasMap) {
    this.atlasMapping = { ...mapping };
    return runtimeCommandSuccess({
      worldId: "mock-drusniel-world",
      savedAt: new Date().toISOString(),
      snapshotId: "mock-atlas-mapping",
    });
  }

  async createProtectedArea(area: ProtectedArea) {
    return runtimeCommandSuccess({ area });
  }

  async updateProtectedArea(areaId: string, patch: Partial<Omit<ProtectedArea, "id">>) {
    return runtimeCommandSuccess({
      area: {
        id: areaId,
        name: patch.name ?? areaId,
        kind: patch.kind ?? "story_lock",
        shape: patch.shape ?? "box",
        priority: patch.priority ?? 1,
        locked: patch.locked ?? false,
        color: patch.color ?? "#22d3ee",
        center: patch.center ?? [0, 0, 0],
        size: patch.size ?? [1, 1, 1],
        bounds: patch.bounds ?? { min: [0, 0, 0], max: [1, 1, 1] },
        rules: patch.rules ?? {
          canMine: false,
          canPlace: false,
          canPaint: false,
          canSpawnProps: false,
          canEditWater: false,
          canSaveModify: false,
        },
      },
    });
  }

  async deleteProtectedArea(areaId: string) {
    return runtimeCommandSuccess({ areaId, deleted: true });
  }

  async saveWorldSnapshot() {
    return runtimeCommandSuccess({
      worldId: "mock-drusniel-world",
      savedAt: new Date().toISOString(),
      snapshotId: `mock-runtime-snapshot-${Date.now()}`,
    });
  }

  onRuntimeEvent(handler: RuntimeEventHandler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private createSnapshot(): RuntimeSnapshot {
    const metrics = {
      ...mockRuntimeMetrics,
      renderQualityPreset: this.renderQualityPreset,
      renderQualityReadouts: getMockRenderQualityReadouts(this.renderQualityPreset),
    };
    const waterReflectionStatus: WaterReflectionStatus = mockWaterRuntimeSnapshot.reflectionStatus;

    return {
      connectionState: this.connectionState,
      capabilities: mockCapabilities,
      metrics,
      renderQuality: {
        preset: this.renderQualityPreset,
        metrics: metrics.renderQualityReadouts,
      },
      selection: null,
      targetedVoxel: null,
      chunks: mockChunks,
      dirtyChunkIds: mockChunks.filter((chunk) => chunk.dirty).map((chunk) => chunk.id),
      waterReflection: {
        waterBodyId: null,
        status: waterReflectionStatus,
      },
      waterVisualProbe: {
        ...mockWaterRuntimeSnapshot,
        capturedAt: new Date().toISOString(),
      },
      atlasMapping: {
        mapping: this.atlasMapping,
        dirty: false,
      },
      propStats: mockPropStats(),
      timingSamples: metrics.timingSamples,
      consoleEvents: [],
      capturedAt: new Date().toISOString(),
    };
  }
}
