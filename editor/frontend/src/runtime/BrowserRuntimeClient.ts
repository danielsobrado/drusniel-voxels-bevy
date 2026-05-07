import type { RenderQualityPreset, Selection, ViewportOverlayState } from "../types/editor";
import type { BlockAtlasMap, BlockType, ProtectedArea, WaterReflectionDebugViewMode, WaterReflectionStatus } from "../types/world";
import type { RuntimeClient } from "./RuntimeClient";
import type { RuntimeCommandRequest } from "./runtimeCommands";
import type { RuntimeEventHandler } from "./runtimeEvents";
import type {
  RuntimeAtlasMappingState,
  RuntimeChunkRebuildResult,
  RuntimeCommandResult,
  RuntimeConnectionState,
  RuntimeFocusCameraResult,
  RuntimeProtectedAreaDeleteResult,
  RuntimeProtectedAreaLoadResult,
  RuntimeProtectedAreaMutationResult,
  RuntimeProtectedAreaValidationResult,
  RuntimeProtectedRuleQueryResult,
  RuntimeRenderQualityState,
  RuntimeSaveSummary,
  RuntimeSelectEntityResult,
  RuntimeSnapshot,
  RuntimeVoxelMutationResult,
  RuntimeViewportDebugState,
  RuntimeWaterDebugModeResult,
  RuntimeWaterVisualProbeResult,
} from "./runtimeSchemas";
import { runtimeCommandFailure } from "./runtimeSchemas";

export interface RuntimeBridge {
  readonly executeCommand: (request: RuntimeCommandRequest) => Promise<RuntimeCommandResult<unknown>>;
  readonly getRuntimeSnapshot?: () => Promise<RuntimeCommandResult<RuntimeSnapshot>>;
  readonly getRenderQuality?: () => Promise<RuntimeCommandResult<RuntimeRenderQualityState>>;
  readonly getWaterReflectionStatus?: () => Promise<RuntimeCommandResult<WaterReflectionStatus>>;
  readonly onRuntimeEvent?: (handler: RuntimeEventHandler) => () => void;
}

declare global {
  interface Window {
    drusnielRuntime?: RuntimeBridge;
  }
}

const unsupported = <T>(message: string): RuntimeCommandResult<T> =>
  runtimeCommandFailure("unsupported", message);

const makeRequestId = (type: string): string =>
  `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const hasBrowserRuntimeBridge = (): boolean =>
  typeof window !== "undefined" && typeof window.drusnielRuntime?.executeCommand === "function";

export class BrowserRuntimeClient implements RuntimeClient {
  private readonly bridge: RuntimeBridge;

  constructor(bridge: RuntimeBridge = window.drusnielRuntime as RuntimeBridge) {
    this.bridge = bridge;
  }

  getConnectionState(): RuntimeConnectionState {
    return "connected";
  }

  async getRuntimeSnapshot(): Promise<RuntimeCommandResult<RuntimeSnapshot>> {
    return this.bridge.getRuntimeSnapshot?.() ?? unsupported("Runtime snapshot reads are not available from this bridge.");
  }

  async getRenderQuality(): Promise<RuntimeCommandResult<RuntimeRenderQualityState>> {
    return this.bridge.getRenderQuality?.() ?? unsupported("Render quality reads are not available from this bridge.");
  }

  async getWaterReflectionStatus(): Promise<RuntimeCommandResult<WaterReflectionStatus>> {
    return this.bridge.getWaterReflectionStatus?.() ?? unsupported("Water reflection status reads are not available from this bridge.");
  }

  async selectEntity(selection: Selection): Promise<RuntimeCommandResult<RuntimeSelectEntityResult>> {
    return this.execute({
      type: "runtime.selectEntity",
      requestId: makeRequestId("runtime.selectEntity"),
      payload: { selection },
    });
  }

  async focusCamera(target: Selection | readonly [number, number, number]): Promise<RuntimeCommandResult<RuntimeFocusCameraResult>> {
    return this.execute({
      type: "runtime.focusCamera",
      requestId: makeRequestId("runtime.focusCamera"),
      payload: { target },
    });
  }

  async rebuildSelectedChunk(chunkId: string): Promise<RuntimeCommandResult<RuntimeChunkRebuildResult>> {
    return this.execute({
      type: "runtime.rebuildSelectedChunk",
      requestId: makeRequestId("runtime.rebuildSelectedChunk"),
      payload: { chunkId },
    });
  }

  async rebuildDirtyChunks(chunkIds: readonly string[]): Promise<RuntimeCommandResult<RuntimeChunkRebuildResult>> {
    return this.execute({
      type: "runtime.rebuildDirtyChunks",
      requestId: makeRequestId("runtime.rebuildDirtyChunks"),
      payload: { chunkIds },
    });
  }

  async setRenderQuality(preset: RenderQualityPreset): Promise<RuntimeCommandResult<RuntimeRenderQualityState>> {
    return this.execute({
      type: "runtime.setRenderQuality",
      requestId: makeRequestId("runtime.setRenderQuality"),
      payload: { preset },
    });
  }

  async setWaterReflectionDebugMode(waterBodyId: string, mode: WaterReflectionDebugViewMode): Promise<RuntimeCommandResult<RuntimeWaterDebugModeResult>> {
    return this.execute({
      type: "runtime.setWaterReflectionDebugMode",
      requestId: makeRequestId("runtime.setWaterReflectionDebugMode"),
      payload: { waterBodyId, mode },
    });
  }

  async runWaterVisualProbe(): Promise<RuntimeCommandResult<RuntimeWaterVisualProbeResult>> {
    return this.execute({
      type: "runtime.runWaterVisualProbe",
      requestId: makeRequestId("runtime.runWaterVisualProbe"),
      payload: {},
    });
  }

  async setVoxel(position: readonly [number, number, number], block: BlockType): Promise<RuntimeCommandResult<RuntimeVoxelMutationResult>> {
    return this.execute({
      type: "runtime.setVoxel",
      requestId: makeRequestId("runtime.setVoxel"),
      payload: { position, block },
    });
  }

  async setViewportDebugOverlay(overlay: keyof ViewportOverlayState, enabled: boolean): Promise<RuntimeCommandResult<RuntimeViewportDebugState>> {
    return this.execute({
      type: "runtime.setViewportDebugOverlay",
      requestId: makeRequestId("runtime.setViewportDebugOverlay"),
      payload: { overlay, enabled },
    });
  }

  async setAtlasMapping(mapping: BlockAtlasMap): Promise<RuntimeCommandResult<RuntimeAtlasMappingState>> {
    return this.execute({
      type: "runtime.setAtlasMapping",
      requestId: makeRequestId("runtime.setAtlasMapping"),
      payload: { mapping },
    });
  }

  async saveAtlasMapping(mapping: BlockAtlasMap): Promise<RuntimeCommandResult<RuntimeSaveSummary>> {
    return this.execute({
      type: "runtime.saveAtlasMapping",
      requestId: makeRequestId("runtime.saveAtlasMapping"),
      payload: { mapping },
    });
  }

  async createProtectedArea(area: ProtectedArea): Promise<RuntimeCommandResult<RuntimeProtectedAreaMutationResult>> {
    return this.execute({
      type: "runtime.createProtectedArea",
      requestId: makeRequestId("runtime.createProtectedArea"),
      payload: { area },
    });
  }

  async updateProtectedArea(areaId: string, patch: Partial<Omit<ProtectedArea, "id">>): Promise<RuntimeCommandResult<RuntimeProtectedAreaMutationResult>> {
    return this.execute({
      type: "runtime.updateProtectedArea",
      requestId: makeRequestId("runtime.updateProtectedArea"),
      payload: { areaId, patch },
    });
  }

  async deleteProtectedArea(areaId: string): Promise<RuntimeCommandResult<RuntimeProtectedAreaDeleteResult>> {
    return this.execute({
      type: "runtime.deleteProtectedArea",
      requestId: makeRequestId("runtime.deleteProtectedArea"),
      payload: { areaId },
    });
  }

  async queryProtectedRulesAtVoxel(voxel: readonly [number, number, number]): Promise<RuntimeCommandResult<RuntimeProtectedRuleQueryResult>> {
    return this.execute({
      type: "runtime.queryProtectedRulesAtVoxel",
      requestId: makeRequestId("runtime.queryProtectedRulesAtVoxel"),
      payload: { voxel },
    });
  }

  async validateProtectedAreaConflicts(area?: ProtectedArea): Promise<RuntimeCommandResult<RuntimeProtectedAreaValidationResult>> {
    return this.execute({
      type: "runtime.validateProtectedAreaConflicts",
      requestId: makeRequestId("runtime.validateProtectedAreaConflicts"),
      payload: area ? { area } : {},
    });
  }

  async saveProtectedAreas(): Promise<RuntimeCommandResult<RuntimeSaveSummary>> {
    return this.execute({
      type: "runtime.saveProtectedAreas",
      requestId: makeRequestId("runtime.saveProtectedAreas"),
      payload: {},
    });
  }

  async loadProtectedAreas(): Promise<RuntimeCommandResult<RuntimeProtectedAreaLoadResult>> {
    return this.execute({
      type: "runtime.loadProtectedAreas",
      requestId: makeRequestId("runtime.loadProtectedAreas"),
      payload: {},
    });
  }

  async saveWorldSnapshot(): Promise<RuntimeCommandResult<RuntimeSaveSummary>> {
    return this.execute({
      type: "runtime.saveWorldSnapshot",
      requestId: makeRequestId("runtime.saveWorldSnapshot"),
      payload: {},
    });
  }

  onRuntimeEvent(handler: RuntimeEventHandler): () => void {
    return this.bridge.onRuntimeEvent?.(handler) ?? (() => undefined);
  }

  private async execute<T>(request: RuntimeCommandRequest): Promise<RuntimeCommandResult<T>> {
    const result = await this.bridge.executeCommand(request);
    return result as RuntimeCommandResult<T>;
  }
}
