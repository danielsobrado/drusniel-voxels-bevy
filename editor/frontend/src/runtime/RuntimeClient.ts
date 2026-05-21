import type { EditorDiagnosticsCategory, RenderQualityPreset, Selection, ViewportOverlayState } from "../types/editor";
import type { BlockAtlasMap, BlockType, LightInstance, MaterialPatch, PropInstance, ProtectedArea, TerrainPreviewRequest, WaterBody, WaterReflectionDebugViewMode, WaterReflectionStatus } from "../types/world";
import type { LightAtmospherePatch, LightAtmosphereSettings, RenderFeatureFlag } from "../types/runtime";
import type { RuntimeEventHandler } from "./runtimeEvents";
import type {
  EditorCameraInteractionMode,
  EditorCameraKind,
  EditorCameraPose,
  EditorCameraProjection,
  EditorCameraTemplate,
  LightAtmosphereTemplate,
  RuntimeAtlasMappingState,
  RuntimeAmbientLightMutationResult,
  RuntimeChunkRebuildResult,
  RuntimeCommandResult,
  RuntimeConnectionState,
  RuntimeDeleteSavedEditorCameraResult,
  RuntimeEditorDiagnosticsState,
  RuntimeEditorCameraResult,
  RuntimeFocusCameraResult,
  RuntimeLightDeleteResult,
  RuntimeLightAtmosphereMutationResult,
  RuntimeLightLoadResult,
  RuntimeLightMutationResult,
  RuntimeActiveMaterialResult,
  RuntimeMaterialMutationResult,
  RuntimeMaterialPaintResult,
  RuntimeMaterialPickResult,
  RuntimeMaterialReplaceResult,
  RuntimeProtectedAreaDeleteResult,
  RuntimeProtectedAreaLoadResult,
  RuntimeProtectedAreaMutationResult,
  RuntimeProtectedAreaValidationResult,
  RuntimeProtectedRuleQueryResult,
  RuntimePropRemoveResult,
  RuntimePropScatterResult,
  RuntimeRenderFeatureFlagResult,
  RuntimeRenderQualityState,
  RuntimeSaveSummary,
  RuntimeSavedEditorCameraResult,
  RuntimeSelectEntityResult,
  RuntimeSnapshot,
  RuntimeVoxelMutationResult,
  RuntimeViewportDebugState,
  RuntimeWaterBodyMutationResult,
  RuntimeWaterDebugModeResult,
  RuntimeWaterVisualProbeResult,
  RuntimeTerrainRecipeState,
  RuntimeTerrainPreviewResult,
  RuntimeVoxelBrushRequest,
  RuntimeVoxelBrushResult,
} from "./runtimeSchemas";

export type { RuntimeCommandResult, RuntimeCommandStatus, RuntimeSnapshot } from "./runtimeSchemas";

export interface RuntimeClient {
  readonly getConnectionState: () => RuntimeConnectionState;
  readonly getRuntimeSnapshot: () => Promise<RuntimeCommandResult<RuntimeSnapshot>>;
  readonly getRenderQuality: () => Promise<RuntimeCommandResult<RuntimeRenderQualityState>>;
  readonly getWaterReflectionStatus: () => Promise<RuntimeCommandResult<WaterReflectionStatus>>;
  readonly selectEntity: (selection: Selection) => Promise<RuntimeCommandResult<RuntimeSelectEntityResult>>;
  readonly focusCamera: (target: Selection | readonly [number, number, number]) => Promise<RuntimeCommandResult<RuntimeFocusCameraResult>>;
  readonly setEditorCameraMode: (patch: { readonly interactionMode?: EditorCameraInteractionMode; readonly cameraKind?: EditorCameraKind }) => Promise<RuntimeCommandResult<RuntimeEditorCameraResult>>;
  readonly setEditorCameraProjection: (projection: EditorCameraProjection, options?: { readonly fovDegrees?: number; readonly orthographicScale?: number }) => Promise<RuntimeCommandResult<RuntimeEditorCameraResult>>;
  readonly setEditorCameraPose: (pose: EditorCameraPose) => Promise<RuntimeCommandResult<RuntimeEditorCameraResult>>;
  readonly alignEditorCameraToAxes: (axis?: string, automatic?: boolean) => Promise<RuntimeCommandResult<RuntimeEditorCameraResult>>;
  readonly addSavedEditorCamera: (input?: { readonly name?: string; readonly description?: string }) => Promise<RuntimeCommandResult<RuntimeSavedEditorCameraResult>>;
  readonly updateSavedEditorCamera: (cameraId: string, input?: { readonly name?: string; readonly description?: string }) => Promise<RuntimeCommandResult<RuntimeSavedEditorCameraResult>>;
  readonly deleteSavedEditorCamera: (cameraId: string) => Promise<RuntimeCommandResult<RuntimeDeleteSavedEditorCameraResult>>;
  readonly recallSavedEditorCamera: (cameraId: string) => Promise<RuntimeCommandResult<RuntimeEditorCameraResult>>;
  readonly stepSavedEditorCamera: (direction: number) => Promise<RuntimeCommandResult<RuntimeEditorCameraResult>>;
  readonly importEditorCameraTemplate: (template: EditorCameraTemplate) => Promise<RuntimeCommandResult<RuntimeEditorCameraResult>>;
  readonly exportEditorCameraTemplate: () => Promise<RuntimeCommandResult<EditorCameraTemplate>>;
  readonly rebuildSelectedChunk: (chunkId: string) => Promise<RuntimeCommandResult<RuntimeChunkRebuildResult>>;
  readonly rebuildDirtyChunks: (chunkIds: readonly string[]) => Promise<RuntimeCommandResult<RuntimeChunkRebuildResult>>;
  readonly setRenderQuality: (preset: RenderQualityPreset) => Promise<RuntimeCommandResult<RuntimeRenderQualityState>>;
  readonly setRenderFeatureFlag: (feature: RenderFeatureFlag, enabled: boolean, value?: number) => Promise<RuntimeCommandResult<RuntimeRenderFeatureFlagResult>>;
  readonly updateAmbientLight: (color: string, brightness: number) => Promise<RuntimeCommandResult<RuntimeAmbientLightMutationResult>>;
  readonly getLightAtmosphere: () => Promise<RuntimeCommandResult<LightAtmosphereSettings>>;
  readonly updateLightAtmosphere: (patch: LightAtmospherePatch) => Promise<RuntimeCommandResult<RuntimeLightAtmosphereMutationResult>>;
  readonly importLightAtmosphereTemplate: (template: LightAtmosphereTemplate) => Promise<RuntimeCommandResult<RuntimeLightAtmosphereMutationResult>>;
  readonly exportLightAtmosphereTemplate: () => Promise<RuntimeCommandResult<LightAtmosphereTemplate>>;
  readonly setWaterReflectionDebugMode: (waterBodyId: string, mode: WaterReflectionDebugViewMode) => Promise<RuntimeCommandResult<RuntimeWaterDebugModeResult>>;
  readonly updateWaterBody: (waterBodyId: string, patch: Partial<WaterBody>) => Promise<RuntimeCommandResult<RuntimeWaterBodyMutationResult>>;
  readonly runWaterVisualProbe: () => Promise<RuntimeCommandResult<RuntimeWaterVisualProbeResult>>;
  readonly getDefaultTerrainRecipe: () => Promise<RuntimeCommandResult<RuntimeTerrainRecipeState>>;
  readonly previewTerrainRecipe: (request: TerrainPreviewRequest) => Promise<RuntimeCommandResult<RuntimeTerrainPreviewResult>>;
  readonly setVoxel: (position: readonly [number, number, number], block: BlockType) => Promise<RuntimeCommandResult<RuntimeVoxelMutationResult>>;
  readonly paintVoxelMaterial: (position: readonly [number, number, number], materialId: string) => Promise<RuntimeCommandResult<RuntimeMaterialPaintResult>>;
  readonly pickVoxelMaterial: (position: readonly [number, number, number]) => Promise<RuntimeCommandResult<RuntimeMaterialPickResult>>;
  readonly replaceMaterial: (fromMaterialId: string, toMaterialId: string) => Promise<RuntimeCommandResult<RuntimeMaterialReplaceResult>>;
  readonly getMaterialReplaceJob: (jobId: string) => Promise<RuntimeCommandResult<RuntimeMaterialReplaceResult>>;
  readonly updateMaterial: (materialId: string, patch: MaterialPatch) => Promise<RuntimeCommandResult<RuntimeMaterialMutationResult>>;
  readonly setActiveMaterial: (materialId: string) => Promise<RuntimeCommandResult<RuntimeActiveMaterialResult>>;
  readonly applyVoxelBrush: (brush: RuntimeVoxelBrushRequest) => Promise<RuntimeCommandResult<RuntimeVoxelBrushResult>>;
  readonly setViewportDebugOverlay: (overlay: keyof ViewportOverlayState, enabled: boolean) => Promise<RuntimeCommandResult<RuntimeViewportDebugState>>;
  readonly setEditorDiagnostics: (enabled: boolean, categories?: readonly EditorDiagnosticsCategory[]) => Promise<RuntimeCommandResult<RuntimeEditorDiagnosticsState>>;
  readonly setAtlasMapping: (mapping: BlockAtlasMap) => Promise<RuntimeCommandResult<RuntimeAtlasMappingState>>;
  readonly saveAtlasMapping: (mapping: BlockAtlasMap) => Promise<RuntimeCommandResult<RuntimeSaveSummary>>;
  readonly scatterProps: (props: readonly PropInstance[]) => Promise<RuntimeCommandResult<RuntimePropScatterResult>>;
  readonly removeProps: (filter: { readonly propIds?: readonly string[]; readonly chunkId?: string }) => Promise<RuntimeCommandResult<RuntimePropRemoveResult>>;
  readonly createLight: (light: LightInstance) => Promise<RuntimeCommandResult<RuntimeLightMutationResult>>;
  readonly updateLight: (lightId: string, patch: Partial<Omit<LightInstance, "id">>) => Promise<RuntimeCommandResult<RuntimeLightMutationResult>>;
  readonly deleteLight: (lightId: string) => Promise<RuntimeCommandResult<RuntimeLightDeleteResult>>;
  readonly saveLights: () => Promise<RuntimeCommandResult<RuntimeSaveSummary>>;
  readonly loadLights: () => Promise<RuntimeCommandResult<RuntimeLightLoadResult>>;
  readonly createProtectedArea: (area: ProtectedArea) => Promise<RuntimeCommandResult<RuntimeProtectedAreaMutationResult>>;
  readonly updateProtectedArea: (areaId: string, patch: Partial<Omit<ProtectedArea, "id">>) => Promise<RuntimeCommandResult<RuntimeProtectedAreaMutationResult>>;
  readonly deleteProtectedArea: (areaId: string) => Promise<RuntimeCommandResult<RuntimeProtectedAreaDeleteResult>>;
  readonly queryProtectedRulesAtVoxel: (voxel: readonly [number, number, number]) => Promise<RuntimeCommandResult<RuntimeProtectedRuleQueryResult>>;
  readonly validateProtectedAreaConflicts: (area?: ProtectedArea) => Promise<RuntimeCommandResult<RuntimeProtectedAreaValidationResult>>;
  readonly saveProtectedAreas: () => Promise<RuntimeCommandResult<RuntimeSaveSummary>>;
  readonly loadProtectedAreas: () => Promise<RuntimeCommandResult<RuntimeProtectedAreaLoadResult>>;
  readonly saveWorldSnapshot: () => Promise<RuntimeCommandResult<RuntimeSaveSummary>>;
  readonly onRuntimeEvent: (handler: RuntimeEventHandler) => () => void;
}
