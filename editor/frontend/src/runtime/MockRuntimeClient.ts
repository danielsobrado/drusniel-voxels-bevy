import { getMockRenderQualityReadouts, mockRuntimeMetrics, mockWaterRuntimeSnapshot } from "../mocks/mockRuntime";
import { mockAtlasMapping, mockChunks, mockProps, mockProtectedAreas } from "../mocks/mockWorld";
import type { RenderQualityPreset, Selection, ViewportOverlayState } from "../types/editor";
import type { BlockAtlasMap, ProtectedArea, WaterReflectionDebugViewMode, WaterReflectionStatus } from "../types/world";
import type { RuntimeClient } from "./RuntimeClient";
import type { RuntimeEventHandler } from "./runtimeEvents";
import type { RuntimeConnectionState, RuntimeProtectedAreaConflict, RuntimeSnapshot } from "./runtimeSchemas";
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

const pointInsideBounds = (point: readonly [number, number, number], bounds: ProtectedArea["bounds"]): boolean =>
  point[0] >= bounds.min[0] &&
  point[0] <= bounds.max[0] &&
  point[1] >= bounds.min[1] &&
  point[1] <= bounds.max[1] &&
  point[2] >= bounds.min[2] &&
  point[2] <= bounds.max[2];

const boundsOverlap = (left: ProtectedArea["bounds"], right: ProtectedArea["bounds"]): boolean =>
  left.min[0] <= right.max[0] &&
  left.max[0] >= right.min[0] &&
  left.min[1] <= right.max[1] &&
  left.max[1] >= right.min[1] &&
  left.min[2] <= right.max[2] &&
  left.max[2] >= right.min[2];

export class MockRuntimeClient implements RuntimeClient {
  private renderQualityPreset: RenderQualityPreset = mockRuntimeMetrics.renderQualityPreset;
  private atlasMapping: BlockAtlasMap = { ...mockAtlasMapping };
  private protectedAreas: ProtectedArea[] = [...mockProtectedAreas];
  private connectionState: RuntimeConnectionState = "mock";
  private viewportDebug: ViewportOverlayState = {
    chunkBounds: true,
    voxelGrid: true,
    waterDebug: false,
    protectedAreas: true,
    propBounds: true,
    propBillboards: true,
    agentTargets: true,
    atlasPreview: false,
    wireframe: false,
  };
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

  async setViewportDebugOverlay(overlay: keyof ViewportOverlayState, enabled: boolean) {
    this.viewportDebug = { ...this.viewportDebug, [overlay]: enabled };
    return runtimeCommandSuccess(this.viewportDebug);
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
    this.protectedAreas = [...this.protectedAreas.filter((candidate) => candidate.id !== area.id), area];
    return runtimeCommandSuccess({ area });
  }

  async updateProtectedArea(areaId: string, patch: Partial<Omit<ProtectedArea, "id">>) {
    const existing = this.protectedAreas.find((area) => area.id === areaId);
    const next: ProtectedArea = existing
      ? { ...existing, ...patch }
      : {
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
        };
    this.protectedAreas = [...this.protectedAreas.filter((area) => area.id !== areaId), next];
    return runtimeCommandSuccess({
      area: next,
    });
  }

  async deleteProtectedArea(areaId: string) {
    const before = this.protectedAreas.length;
    this.protectedAreas = this.protectedAreas.filter((area) => area.id !== areaId);
    return runtimeCommandSuccess({ areaId, deleted: this.protectedAreas.length !== before });
  }

  async queryProtectedRulesAtVoxel(voxel: readonly [number, number, number]) {
    const area = this.protectedAreas.find((candidate) => pointInsideBounds(voxel, candidate.bounds));
    return runtimeCommandSuccess({
      position: voxel,
      blocked: Boolean(area && Object.values(area.rules).some((allowed) => !allowed)),
      areaId: area?.id ?? null,
      areaName: area?.name ?? null,
      kind: area?.kind ?? null,
      priority: area?.priority ?? null,
      rules:
        area?.rules ?? {
          canMine: true,
          canPlace: true,
          canPaint: true,
          canSpawnProps: true,
          canEditWater: true,
          canSaveModify: true,
        },
    });
  }

  async validateProtectedAreaConflicts(area?: ProtectedArea) {
    const candidates = area ? [...this.protectedAreas.filter((candidate) => candidate.id !== area.id), area] : this.protectedAreas;
    const conflicts: RuntimeProtectedAreaConflict[] = [];
    for (let index = 0; index < candidates.length; index += 1) {
      for (const other of candidates.slice(index + 1)) {
        const current = candidates[index];
        if (current.priority === other.priority && boundsOverlap(current.bounds, other.bounds)) {
          conflicts.push({
            leftAreaId: current.id,
            rightAreaId: other.id,
            priority: current.priority,
            message: `Protected areas ${current.name} and ${other.name} overlap at priority ${current.priority}.`,
          });
        }
      }
    }
    return runtimeCommandSuccess({ clear: conflicts.length === 0, conflicts });
  }

  async saveProtectedAreas() {
    return runtimeCommandSuccess({
      worldId: "mock-drusniel-world",
      savedAt: new Date().toISOString(),
      snapshotId: "mock-world-rules",
    });
  }

  async loadProtectedAreas() {
    return runtimeCommandSuccess({
      areas: this.protectedAreas,
      areaCount: this.protectedAreas.length,
    });
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
      viewportDebug: this.viewportDebug,
      propStats: mockPropStats(),
      timingSamples: metrics.timingSamples,
      consoleEvents: [],
      capturedAt: new Date().toISOString(),
    };
  }
}
