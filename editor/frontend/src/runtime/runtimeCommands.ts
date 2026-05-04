import type { RenderQualityPreset, Selection } from "../types/editor";
import type { BlockAtlasMap, ProtectedArea, WaterReflectionDebugViewMode } from "../types/world";

export type RuntimeCommandRequestType =
  | "runtime.selectEntity"
  | "runtime.focusCamera"
  | "runtime.rebuildSelectedChunk"
  | "runtime.rebuildDirtyChunks"
  | "runtime.setRenderQuality"
  | "runtime.setWaterReflectionDebugMode"
  | "runtime.runWaterVisualProbe"
  | "runtime.setAtlasMapping"
  | "runtime.saveAtlasMapping"
  | "runtime.createProtectedArea"
  | "runtime.updateProtectedArea"
  | "runtime.deleteProtectedArea"
  | "runtime.saveWorldSnapshot";

interface RuntimeCommandRequestBase<TType extends RuntimeCommandRequestType, TPayload> {
  readonly type: TType;
  readonly requestId: string;
  readonly payload: TPayload;
}

export type RuntimeSelectEntityCommand = RuntimeCommandRequestBase<"runtime.selectEntity", { readonly selection: Selection }>;
export type RuntimeFocusCameraCommand = RuntimeCommandRequestBase<"runtime.focusCamera", { readonly target: Selection | readonly [number, number, number] }>;
export type RuntimeRebuildSelectedChunkCommand = RuntimeCommandRequestBase<"runtime.rebuildSelectedChunk", { readonly chunkId: string }>;
export type RuntimeRebuildDirtyChunksCommand = RuntimeCommandRequestBase<"runtime.rebuildDirtyChunks", { readonly chunkIds: readonly string[] }>;
export type RuntimeSetRenderQualityCommand = RuntimeCommandRequestBase<"runtime.setRenderQuality", { readonly preset: RenderQualityPreset }>;
export type RuntimeSetWaterReflectionDebugModeCommand = RuntimeCommandRequestBase<"runtime.setWaterReflectionDebugMode", { readonly waterBodyId: string; readonly mode: WaterReflectionDebugViewMode }>;
export type RuntimeRunWaterVisualProbeCommand = RuntimeCommandRequestBase<"runtime.runWaterVisualProbe", Record<string, never>>;
export type RuntimeSetAtlasMappingCommand = RuntimeCommandRequestBase<"runtime.setAtlasMapping", { readonly mapping: BlockAtlasMap }>;
export type RuntimeSaveAtlasMappingCommand = RuntimeCommandRequestBase<"runtime.saveAtlasMapping", { readonly mapping: BlockAtlasMap }>;
export type RuntimeCreateProtectedAreaCommand = RuntimeCommandRequestBase<"runtime.createProtectedArea", { readonly area: ProtectedArea }>;
export type RuntimeUpdateProtectedAreaCommand = RuntimeCommandRequestBase<"runtime.updateProtectedArea", { readonly areaId: string; readonly patch: Partial<Omit<ProtectedArea, "id">> }>;
export type RuntimeDeleteProtectedAreaCommand = RuntimeCommandRequestBase<"runtime.deleteProtectedArea", { readonly areaId: string }>;
export type RuntimeSaveWorldSnapshotCommand = RuntimeCommandRequestBase<"runtime.saveWorldSnapshot", { readonly reason?: string }>;

export type RuntimeCommandRequest =
  | RuntimeSelectEntityCommand
  | RuntimeFocusCameraCommand
  | RuntimeRebuildSelectedChunkCommand
  | RuntimeRebuildDirtyChunksCommand
  | RuntimeSetRenderQualityCommand
  | RuntimeSetWaterReflectionDebugModeCommand
  | RuntimeRunWaterVisualProbeCommand
  | RuntimeSetAtlasMappingCommand
  | RuntimeSaveAtlasMappingCommand
  | RuntimeCreateProtectedAreaCommand
  | RuntimeUpdateProtectedAreaCommand
  | RuntimeDeleteProtectedAreaCommand
  | RuntimeSaveWorldSnapshotCommand;
