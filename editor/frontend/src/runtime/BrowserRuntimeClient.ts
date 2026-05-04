import type { RenderQualityPreset, Selection } from "../types/editor";
import type { BlockAtlasMap, ProtectedArea, WaterReflectionDebugViewMode, WaterReflectionStatus } from "../types/world";
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
  RuntimeProtectedAreaMutationResult,
  RuntimeRenderQualityState,
  RuntimeSaveSummary,
  RuntimeSelectEntityResult,
  RuntimeSnapshot,
  RuntimeWaterDebugModeResult,
  RuntimeWaterVisualProbeResult,
} from "./runtimeSchemas";
import { runtimeCommandFailure } from "./runtimeSchemas";

interface RuntimeBridge {
  readonly executeCommand: (request: RuntimeCommandRequest) => Promise<RuntimeCommandResult<unknown>>;
  readonly getRuntimeSnapshot?: () => Promise<RuntimeCommandResult<RuntimeSnapshot>>;
  readonly getRenderQuality?: () => Promise<RuntimeCommandResult<RuntimeRenderQualityState>>;
  readonly getWaterReflectionStatus?: () => Promise<RuntimeCommandResult<WaterReflectionStatus>>;
  readonly onRuntimeEvent?: (handler: RuntimeEventHandler) => () => void;
}

declare global {
  interface Window {
    readonly drusnielRuntime?: RuntimeBridge;
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
    return unsupported(`Runtime selection is not enabled for ${selection.label}.`);
  }

  async focusCamera(target: Selection | readonly [number, number, number]): Promise<RuntimeCommandResult<RuntimeFocusCameraResult>> {
    void target;
    return unsupported("Runtime camera focus is not part of the safe write-command bridge.");
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
    void area;
    return unsupported("Protected area runtime writes are intentionally not enabled in this sprint.");
  }

  async updateProtectedArea(areaId: string, patch: Partial<Omit<ProtectedArea, "id">>): Promise<RuntimeCommandResult<RuntimeProtectedAreaMutationResult>> {
    void areaId;
    void patch;
    return unsupported("Protected area runtime writes are intentionally not enabled in this sprint.");
  }

  async deleteProtectedArea(areaId: string): Promise<RuntimeCommandResult<RuntimeProtectedAreaDeleteResult>> {
    void areaId;
    return unsupported("Protected area runtime writes are intentionally not enabled in this sprint.");
  }

  async saveWorldSnapshot(): Promise<RuntimeCommandResult<RuntimeSaveSummary>> {
    return unsupported("Large world save/load is intentionally not enabled in this sprint.");
  }

  onRuntimeEvent(handler: RuntimeEventHandler): () => void {
    return this.bridge.onRuntimeEvent?.(handler) ?? (() => undefined);
  }

  private async execute<T>(request: RuntimeCommandRequest): Promise<RuntimeCommandResult<T>> {
    const result = await this.bridge.executeCommand(request);
    return result as RuntimeCommandResult<T>;
  }
}
