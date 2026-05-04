import type { RenderQualityPreset, Selection } from "../types/editor";
import type { BlockAtlasMap, ProtectedArea, WaterReflectionDebugViewMode, WaterReflectionStatus } from "../types/world";
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

export type { RuntimeCommandResult, RuntimeCommandStatus, RuntimeSnapshot } from "./runtimeSchemas";

export interface RuntimeClient {
  readonly getConnectionState: () => RuntimeConnectionState;
  readonly getRuntimeSnapshot: () => Promise<RuntimeCommandResult<RuntimeSnapshot>>;
  readonly getRenderQuality: () => Promise<RuntimeCommandResult<RuntimeRenderQualityState>>;
  readonly getWaterReflectionStatus: () => Promise<RuntimeCommandResult<WaterReflectionStatus>>;
  readonly selectEntity: (selection: Selection) => Promise<RuntimeCommandResult<RuntimeSelectEntityResult>>;
  readonly focusCamera: (target: Selection | readonly [number, number, number]) => Promise<RuntimeCommandResult<RuntimeFocusCameraResult>>;
  readonly rebuildSelectedChunk: (chunkId: string) => Promise<RuntimeCommandResult<RuntimeChunkRebuildResult>>;
  readonly rebuildDirtyChunks: (chunkIds: readonly string[]) => Promise<RuntimeCommandResult<RuntimeChunkRebuildResult>>;
  readonly setRenderQuality: (preset: RenderQualityPreset) => Promise<RuntimeCommandResult<RuntimeRenderQualityState>>;
  readonly setWaterReflectionDebugMode: (waterBodyId: string, mode: WaterReflectionDebugViewMode) => Promise<RuntimeCommandResult<RuntimeWaterDebugModeResult>>;
  readonly runWaterVisualProbe: () => Promise<RuntimeCommandResult<RuntimeWaterVisualProbeResult>>;
  readonly setAtlasMapping: (mapping: BlockAtlasMap) => Promise<RuntimeCommandResult<RuntimeAtlasMappingState>>;
  readonly saveAtlasMapping: (mapping: BlockAtlasMap) => Promise<RuntimeCommandResult<RuntimeSaveSummary>>;
  readonly createProtectedArea: (area: ProtectedArea) => Promise<RuntimeCommandResult<RuntimeProtectedAreaMutationResult>>;
  readonly updateProtectedArea: (areaId: string, patch: Partial<Omit<ProtectedArea, "id">>) => Promise<RuntimeCommandResult<RuntimeProtectedAreaMutationResult>>;
  readonly deleteProtectedArea: (areaId: string) => Promise<RuntimeCommandResult<RuntimeProtectedAreaDeleteResult>>;
  readonly saveWorldSnapshot: () => Promise<RuntimeCommandResult<RuntimeSaveSummary>>;
  readonly onRuntimeEvent: (handler: RuntimeEventHandler) => () => void;
}
