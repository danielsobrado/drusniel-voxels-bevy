import type { EditorDiagnosticsCategory, RenderQualityPreset, Selection, ViewportOverlayState } from "../types/editor";
import type { RenderFeatureFlag } from "../types/runtime";
import type { BlockAtlasMap, BlockType, LightInstance, PropInstance, ProtectedArea, TerrainPreviewRequest, WaterBody, WaterReflectionDebugViewMode } from "../types/world";
import type { EditorCameraInteractionMode, EditorCameraKind, EditorCameraPose, EditorCameraProjection, EditorCameraTemplate } from "./runtimeSchemas";

export type RuntimeCommandRequestType =
  | "runtime.selectEntity"
  | "runtime.focusCamera"
  | "runtime.setEditorCameraMode"
  | "runtime.setEditorCameraProjection"
  | "runtime.setEditorCameraPose"
  | "runtime.alignEditorCameraToAxes"
  | "runtime.addSavedEditorCamera"
  | "runtime.updateSavedEditorCamera"
  | "runtime.deleteSavedEditorCamera"
  | "runtime.recallSavedEditorCamera"
  | "runtime.stepSavedEditorCamera"
  | "runtime.importEditorCameraTemplate"
  | "runtime.exportEditorCameraTemplate"
  | "runtime.rebuildSelectedChunk"
  | "runtime.rebuildDirtyChunks"
  | "runtime.setRenderQuality"
  | "runtime.setRenderFeatureFlag"
  | "runtime.setShaderFeature"
  | "runtime.updateAmbientLight"
  | "runtime.setWaterReflectionDebugMode"
  | "runtime.updateWaterBody"
  | "runtime.runWaterVisualProbe"
  | "runtime.getDefaultTerrainRecipe"
  | "runtime.previewTerrainRecipe"
  | "runtime.setVoxel"
  | "runtime.setViewportDebugOverlay"
  | "runtime.setEditorDiagnostics"
  | "runtime.setAtlasMapping"
  | "runtime.saveAtlasMapping"
  | "runtime.scatterProps"
  | "runtime.removeProps"
  | "runtime.createLight"
  | "runtime.updateLight"
  | "runtime.deleteLight"
  | "runtime.saveLights"
  | "runtime.loadLights"
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
export type RuntimeSetEditorCameraModeCommand = RuntimeCommandRequestBase<"runtime.setEditorCameraMode", { readonly interactionMode?: EditorCameraInteractionMode; readonly cameraKind?: EditorCameraKind }>;
export type RuntimeSetEditorCameraProjectionCommand = RuntimeCommandRequestBase<"runtime.setEditorCameraProjection", { readonly projection: EditorCameraProjection; readonly fovDegrees?: number; readonly orthographicScale?: number }>;
export type RuntimeSetEditorCameraPoseCommand = RuntimeCommandRequestBase<"runtime.setEditorCameraPose", { readonly pose: EditorCameraPose }>;
export type RuntimeAlignEditorCameraToAxesCommand = RuntimeCommandRequestBase<"runtime.alignEditorCameraToAxes", { readonly axis?: string; readonly automatic?: boolean }>;
export type RuntimeAddSavedEditorCameraCommand = RuntimeCommandRequestBase<"runtime.addSavedEditorCamera", { readonly name?: string; readonly description?: string }>;
export type RuntimeUpdateSavedEditorCameraCommand = RuntimeCommandRequestBase<"runtime.updateSavedEditorCamera", { readonly cameraId: string; readonly name?: string; readonly description?: string }>;
export type RuntimeDeleteSavedEditorCameraCommand = RuntimeCommandRequestBase<"runtime.deleteSavedEditorCamera", { readonly cameraId: string }>;
export type RuntimeRecallSavedEditorCameraCommand = RuntimeCommandRequestBase<"runtime.recallSavedEditorCamera", { readonly cameraId: string }>;
export type RuntimeStepSavedEditorCameraCommand = RuntimeCommandRequestBase<"runtime.stepSavedEditorCamera", { readonly direction: number }>;
export type RuntimeImportEditorCameraTemplateCommand = RuntimeCommandRequestBase<"runtime.importEditorCameraTemplate", { readonly template: EditorCameraTemplate }>;
export type RuntimeExportEditorCameraTemplateCommand = RuntimeCommandRequestBase<"runtime.exportEditorCameraTemplate", Record<string, never>>;
export type RuntimeRebuildSelectedChunkCommand = RuntimeCommandRequestBase<"runtime.rebuildSelectedChunk", { readonly chunkId: string }>;
export type RuntimeRebuildDirtyChunksCommand = RuntimeCommandRequestBase<"runtime.rebuildDirtyChunks", { readonly chunkIds: readonly string[] }>;
export type RuntimeSetRenderQualityCommand = RuntimeCommandRequestBase<"runtime.setRenderQuality", { readonly preset: RenderQualityPreset }>;
export type RuntimeSetRenderFeatureFlagCommand = RuntimeCommandRequestBase<
  "runtime.setRenderFeatureFlag",
  { readonly feature: RenderFeatureFlag; readonly enabled: boolean; readonly value?: number }
>;
export type RuntimeSetShaderFeatureCommand = RuntimeCommandRequestBase<
  "runtime.setShaderFeature",
  { readonly feature: RenderFeatureFlag; readonly enabled: boolean; readonly value?: number }
>;
export type RuntimeUpdateAmbientLightCommand = RuntimeCommandRequestBase<"runtime.updateAmbientLight", { readonly color: string; readonly brightness: number }>;
export type RuntimeSetWaterReflectionDebugModeCommand = RuntimeCommandRequestBase<"runtime.setWaterReflectionDebugMode", { readonly waterBodyId: string; readonly mode: WaterReflectionDebugViewMode }>;
export type RuntimeUpdateWaterBodyCommand = RuntimeCommandRequestBase<"runtime.updateWaterBody", { readonly waterBodyId: string; readonly patch: Partial<WaterBody> }>;
export type RuntimeRunWaterVisualProbeCommand = RuntimeCommandRequestBase<"runtime.runWaterVisualProbe", Record<string, never>>;
export type RuntimeGetDefaultTerrainRecipeCommand = RuntimeCommandRequestBase<"runtime.getDefaultTerrainRecipe", Record<string, never>>;
export type RuntimePreviewTerrainRecipeCommand = RuntimeCommandRequestBase<"runtime.previewTerrainRecipe", { readonly request: TerrainPreviewRequest }>;
export type RuntimeSetVoxelCommand = RuntimeCommandRequestBase<"runtime.setVoxel", { readonly position: readonly [number, number, number]; readonly block: BlockType }>;
export type RuntimeSetViewportDebugOverlayCommand = RuntimeCommandRequestBase<"runtime.setViewportDebugOverlay", { readonly overlay: keyof ViewportOverlayState; readonly enabled: boolean }>;
export type RuntimeSetEditorDiagnosticsCommand = RuntimeCommandRequestBase<"runtime.setEditorDiagnostics", { readonly enabled: boolean; readonly categories?: readonly EditorDiagnosticsCategory[] }>;
export type RuntimeSetAtlasMappingCommand = RuntimeCommandRequestBase<"runtime.setAtlasMapping", { readonly mapping: BlockAtlasMap }>;
export type RuntimeSaveAtlasMappingCommand = RuntimeCommandRequestBase<"runtime.saveAtlasMapping", { readonly mapping: BlockAtlasMap }>;
export type RuntimeScatterPropsCommand = RuntimeCommandRequestBase<"runtime.scatterProps", { readonly props: readonly PropInstance[] }>;
export type RuntimeRemovePropsCommand = RuntimeCommandRequestBase<"runtime.removeProps", { readonly propIds?: readonly string[]; readonly chunkId?: string }>;
export type RuntimeCreateLightCommand = RuntimeCommandRequestBase<"runtime.createLight", { readonly light: LightInstance }>;
export type RuntimeUpdateLightCommand = RuntimeCommandRequestBase<"runtime.updateLight", { readonly lightId: string; readonly patch: Partial<Omit<LightInstance, "id">> }>;
export type RuntimeDeleteLightCommand = RuntimeCommandRequestBase<"runtime.deleteLight", { readonly lightId: string }>;
export type RuntimeSaveLightsCommand = RuntimeCommandRequestBase<"runtime.saveLights", Record<string, never>>;
export type RuntimeLoadLightsCommand = RuntimeCommandRequestBase<"runtime.loadLights", Record<string, never>>;
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
  | RuntimeSetEditorCameraModeCommand
  | RuntimeSetEditorCameraProjectionCommand
  | RuntimeSetEditorCameraPoseCommand
  | RuntimeAlignEditorCameraToAxesCommand
  | RuntimeAddSavedEditorCameraCommand
  | RuntimeUpdateSavedEditorCameraCommand
  | RuntimeDeleteSavedEditorCameraCommand
  | RuntimeRecallSavedEditorCameraCommand
  | RuntimeStepSavedEditorCameraCommand
  | RuntimeImportEditorCameraTemplateCommand
  | RuntimeExportEditorCameraTemplateCommand
  | RuntimeRebuildSelectedChunkCommand
  | RuntimeRebuildDirtyChunksCommand
  | RuntimeSetRenderQualityCommand
  | RuntimeSetRenderFeatureFlagCommand
  | RuntimeSetShaderFeatureCommand
  | RuntimeUpdateAmbientLightCommand
  | RuntimeSetWaterReflectionDebugModeCommand
  | RuntimeUpdateWaterBodyCommand
  | RuntimeRunWaterVisualProbeCommand
  | RuntimeGetDefaultTerrainRecipeCommand
  | RuntimePreviewTerrainRecipeCommand
  | RuntimeSetVoxelCommand
  | RuntimeSetViewportDebugOverlayCommand
  | RuntimeSetEditorDiagnosticsCommand
  | RuntimeSetAtlasMappingCommand
  | RuntimeSaveAtlasMappingCommand
  | RuntimeScatterPropsCommand
  | RuntimeRemovePropsCommand
  | RuntimeCreateLightCommand
  | RuntimeUpdateLightCommand
  | RuntimeDeleteLightCommand
  | RuntimeSaveLightsCommand
  | RuntimeLoadLightsCommand
  | RuntimeCreateProtectedAreaCommand
  | RuntimeUpdateProtectedAreaCommand
  | RuntimeDeleteProtectedAreaCommand
  | RuntimeQueryProtectedRulesAtVoxelCommand
  | RuntimeValidateProtectedAreaConflictsCommand
  | RuntimeSaveProtectedAreasCommand
  | RuntimeLoadProtectedAreasCommand
  | RuntimeSaveWorldSnapshotCommand;
