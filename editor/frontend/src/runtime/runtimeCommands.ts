import type { RenderQualityPreset, Selection, ViewportOverlayState } from "../types/editor";
import type { BlockAtlasMap, BlockType, ProtectedArea, WaterBody, WaterReflectionDebugViewMode } from "../types/world";

export type RuntimeCommandRequestType =
  | "runtime.selectEntity"
  | "runtime.focusCamera"
  | "runtime.rebuildSelectedChunk"
  | "runtime.rebuildDirtyChunks"
  | "runtime.setRenderQuality"
  | "runtime.setWaterReflectionDebugMode"
  | "runtime.updateWaterBody"
  | "runtime.runWaterVisualProbe"
  | "runtime.setVoxel"
  | "runtime.setViewportDebugOverlay"
  | "runtime.setAtlasMapping"
  | "runtime.saveAtlasMapping"
  | "runtime.createProtectedArea"
  | "runtime.updateProtectedArea"
  | "runtime.deleteProtectedArea"
  | "runtime.queryProtectedRulesAtVoxel"
  | "runtime.validateProtectedAreaConflicts"
  | "runtime.saveProtectedAreas"
  | "runtime.loadProtectedAreas"
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
export type RuntimeUpdateWaterBodyCommand = RuntimeCommandRequestBase<"runtime.updateWaterBody", { readonly waterBodyId: string; readonly patch: Partial<WaterBody> }>;
export type RuntimeRunWaterVisualProbeCommand = RuntimeCommandRequestBase<"runtime.runWaterVisualProbe", Record<string, never>>;
export type RuntimeSetVoxelCommand = RuntimeCommandRequestBase<"runtime.setVoxel", { readonly position: readonly [number, number, number]; readonly block: BlockType }>;
export type RuntimeSetViewportDebugOverlayCommand = RuntimeCommandRequestBase<"runtime.setViewportDebugOverlay", { readonly overlay: keyof ViewportOverlayState; readonly enabled: boolean }>;
export type RuntimeSetAtlasMappingCommand = RuntimeCommandRequestBase<"runtime.setAtlasMapping", { readonly mapping: BlockAtlasMap }>;
export type RuntimeSaveAtlasMappingCommand = RuntimeCommandRequestBase<"runtime.saveAtlasMapping", { readonly mapping: BlockAtlasMap }>;
export type RuntimeCreateProtectedAreaCommand = RuntimeCommandRequestBase<"runtime.createProtectedArea", { readonly area: ProtectedArea }>;
export type RuntimeUpdateProtectedAreaCommand = RuntimeCommandRequestBase<"runtime.updateProtectedArea", { readonly areaId: string; readonly patch: Partial<Omit<ProtectedArea, "id">> }>;
export type RuntimeDeleteProtectedAreaCommand = RuntimeCommandRequestBase<"runtime.deleteProtectedArea", { readonly areaId: string }>;
export type RuntimeQueryProtectedRulesAtVoxelCommand = RuntimeCommandRequestBase<"runtime.queryProtectedRulesAtVoxel", { readonly voxel: readonly [number, number, number] }>;
export type RuntimeValidateProtectedAreaConflictsCommand = RuntimeCommandRequestBase<"runtime.validateProtectedAreaConflicts", { readonly area?: ProtectedArea }>;
export type RuntimeSaveProtectedAreasCommand = RuntimeCommandRequestBase<"runtime.saveProtectedAreas", Record<string, never>>;
export type RuntimeLoadProtectedAreasCommand = RuntimeCommandRequestBase<"runtime.loadProtectedAreas", Record<string, never>>;
export type RuntimeSaveWorldSnapshotCommand = RuntimeCommandRequestBase<"runtime.saveWorldSnapshot", { readonly reason?: string }>;

export type RuntimeCommandRequest =
  | RuntimeSelectEntityCommand
  | RuntimeFocusCameraCommand
  | RuntimeRebuildSelectedChunkCommand
  | RuntimeRebuildDirtyChunksCommand
  | RuntimeSetRenderQualityCommand
  | RuntimeSetWaterReflectionDebugModeCommand
  | RuntimeUpdateWaterBodyCommand
  | RuntimeRunWaterVisualProbeCommand
  | RuntimeSetVoxelCommand
  | RuntimeSetViewportDebugOverlayCommand
  | RuntimeSetAtlasMappingCommand
  | RuntimeSaveAtlasMappingCommand
  | RuntimeCreateProtectedAreaCommand
  | RuntimeUpdateProtectedAreaCommand
  | RuntimeDeleteProtectedAreaCommand
  | RuntimeQueryProtectedRulesAtVoxelCommand
  | RuntimeValidateProtectedAreaConflictsCommand
  | RuntimeSaveProtectedAreasCommand
  | RuntimeLoadProtectedAreasCommand
  | RuntimeSaveWorldSnapshotCommand;
