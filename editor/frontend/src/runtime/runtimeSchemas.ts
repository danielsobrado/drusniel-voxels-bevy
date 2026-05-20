import type { EditorDiagnosticsState, RenderQualityPreset, Selection, ViewportOverlayState } from "../types/editor";
import type {
  BlockType,
  BlockAtlasMap,
  ChunkSummary,
  LightInstance,
  PropInstance,
  PropStats,
  ProtectedArea,
  ProtectedAreaRuleMatrix,
  WaterBody,
  WaterReflectionDebugViewMode,
  WaterReflectionStatus,
  WaterRuntimeSnapshot,
  TerrainPreviewResult,
  TerrainRecipe,
} from "../types/world";
import type { ConsoleMessage, GraphicsCapabilities, RenderFeatureFlag, RenderTimingSample, RuntimeMetrics } from "../types/runtime";

export type RuntimeConnectionState = "mock" | "connected" | "disconnected" | "stale" | "error";

export interface RuntimeCapabilities {
  readonly canSelectEntity: boolean;
  readonly canFocusCamera: boolean;
  readonly canRebuildChunks: boolean;
  readonly canSetRenderQuality: boolean;
  readonly canDebugWaterReflections: boolean;
  readonly canRunWaterVisualProbe: boolean;
  readonly canEditAtlasMapping: boolean;
  readonly canEditProtectedAreas: boolean;
  readonly canEditLights: boolean;
  readonly canSaveWorldSnapshot: boolean;
}

export interface RuntimeRenderQualityState {
  readonly preset: RenderQualityPreset;
  readonly metrics: RuntimeMetrics["renderQualityReadouts"];
}

export interface RuntimeWaterReflectionState {
  readonly waterBodyId: string | null;
  readonly status: WaterReflectionStatus;
}

export interface RuntimeWaterVisualProbeResult extends WaterRuntimeSnapshot {
  readonly capturedAt: string;
}

export interface RuntimeAtlasMappingState {
  readonly mapping: BlockAtlasMap;
  readonly dirty: boolean;
  readonly savedAt?: string;
}

export type RuntimeViewportDebugState = ViewportOverlayState;
export type RuntimeEditorDiagnosticsState = EditorDiagnosticsState;
export type EditorCameraInteractionMode = "menu" | "movement";
export type EditorCameraKind = "firstPerson" | "arcball";
export type EditorCameraProjection = "perspective" | "orthographic";

export interface EditorCameraPose {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
  readonly radius: number;
  readonly fovDegrees: number;
  readonly orthographicScale: number;
}

export interface EditorSavedCamera {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly cameraKind: EditorCameraKind;
  readonly projection: EditorCameraProjection;
  readonly pose: EditorCameraPose;
  readonly alignToAxes: boolean;
  readonly automaticAxis: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EditorCameraState {
  readonly interactionMode: EditorCameraInteractionMode;
  readonly cameraKind: EditorCameraKind;
  readonly projection: EditorCameraProjection;
  readonly pose: EditorCameraPose;
  readonly alignToAxes: boolean;
  readonly automaticAxis: boolean;
  readonly savedCameras: readonly EditorSavedCamera[];
  readonly activeSavedCameraId?: string;
}

export interface EditorCameraTemplate {
  readonly schema: "drusniel.camera-template.v1";
  readonly cameras: readonly EditorSavedCamera[];
}

export type RuntimeChunkSummary = ChunkSummary;
export type RuntimePropStats = PropStats;
export type RuntimeRenderTimingSample = RenderTimingSample;

export interface RuntimeConsoleEvent extends ConsoleMessage {
  readonly source: "runtime" | "bridge" | "mock";
}

export interface RuntimeSnapshot {
  readonly connectionState: RuntimeConnectionState;
  readonly capabilities: RuntimeCapabilities;
  readonly metrics: RuntimeMetrics;
  readonly renderQuality: RuntimeRenderQualityState;
  readonly selection: Selection | null;
  readonly targetedVoxel: readonly [number, number, number] | null;
  readonly chunks: readonly RuntimeChunkSummary[];
  readonly dirtyChunkIds: readonly string[];
  readonly waterReflection: RuntimeWaterReflectionState;
  readonly waterVisualProbe: RuntimeWaterVisualProbeResult;
  readonly atlasMapping: RuntimeAtlasMappingState;
  readonly viewportDebug: RuntimeViewportDebugState;
  readonly editorDiagnostics: RuntimeEditorDiagnosticsState;
  readonly editorCamera: EditorCameraState;
  readonly propStats: RuntimePropStats;
  readonly lights: readonly LightInstance[];
  readonly timingSamples: readonly RuntimeRenderTimingSample[];
  readonly consoleEvents: readonly RuntimeConsoleEvent[];
  readonly capturedAt: string;
}

export type RuntimeCommandStatus = "success" | "failure" | "validation_error" | "runtime_unavailable" | "unsupported";

export type RuntimeCommandResult<T = void> =
  | { readonly status: "success"; readonly ok: true; readonly data: T }
  | {
      readonly status: Exclude<RuntimeCommandStatus, "success">;
      readonly ok: false;
      readonly message: string;
      readonly code?: string;
      readonly validationErrors?: readonly string[];
    };

export const runtimeCommandSuccess = <T>(data: T): RuntimeCommandResult<T> => ({
  status: "success",
  ok: true,
  data,
});

export const runtimeCommandFailure = (
  status: Exclude<RuntimeCommandStatus, "success">,
  message: string,
  options: { readonly code?: string; readonly validationErrors?: readonly string[] } = {},
): RuntimeCommandResult<never> => ({
  status,
  ok: false,
  message,
  ...options,
});

export interface RuntimeSelectEntityResult {
  readonly selection: Selection;
}

export interface RuntimeFocusCameraResult {
  readonly target: Selection | readonly [number, number, number];
}

export type RuntimeEditorCameraResult = EditorCameraState;

export interface RuntimeSavedEditorCameraResult {
  readonly camera: EditorSavedCamera;
  readonly editorCamera: EditorCameraState;
}

export interface RuntimeDeleteSavedEditorCameraResult {
  readonly cameraId: string;
  readonly deleted: boolean;
  readonly editorCamera: EditorCameraState;
}

export interface RuntimeChunkRebuildResult {
  readonly queuedChunkIds: readonly string[];
}

export type RuntimeVoxelEditResult =
  | "applied"
  | "noChange"
  | "rejectedOutOfBounds"
  | "rejectedBelowWorldFloor"
  | "rejectedUnbreakable"
  | "rejectedMissingChunk"
  | "rejectedProtectedArea";

export interface RuntimeVoxelMutationResult {
  readonly position: readonly [number, number, number];
  readonly chunkId: string;
  readonly block: BlockType;
  readonly voxel: string;
  readonly previousVoxel: string | null;
  readonly currentVoxel: string | null;
  readonly editResult: RuntimeVoxelEditResult;
}

export interface RuntimeWaterDebugModeResult {
  readonly waterBodyId: string;
  readonly mode: WaterReflectionDebugViewMode;
}

export interface RuntimeRenderFeatureFlagResult {
  readonly feature: RenderFeatureFlag;
  readonly enabled: boolean;
  readonly value: boolean | number;
  readonly metrics: Pick<RuntimeMetrics, "shadowBudget" | "ambientOcclusion" | "lightingAtmosphere" | "graphicsCapabilities" | "cinematicPhotoMode">;
}

export interface RuntimeAmbientLightMutationResult {
  readonly color: string;
  readonly brightness: number;
  readonly metrics: Pick<RuntimeMetrics, "lightingAtmosphere">;
}

export interface RuntimeWaterBodyMutationResult {
  readonly waterBody: Partial<WaterBody> & Pick<WaterBody, "id" | "kind" | "reflectionStrength" | "fresnelPower" | "distortionStrength">;
}

export interface RuntimeSaveSummary {
  readonly worldId: string;
  readonly savedAt: string;
  readonly snapshotId?: string;
  readonly editorPropCount?: number;
  readonly editorPropSavePath?: string;
}

export interface RuntimeProtectedAreaMutationResult {
  readonly area: ProtectedArea;
}

export interface RuntimeProtectedAreaDeleteResult {
  readonly areaId: string;
  readonly deleted: boolean;
}

export interface RuntimeProtectedAreaConflict {
  readonly leftAreaId: string;
  readonly rightAreaId: string;
  readonly priority: number;
  readonly message: string;
}

export interface RuntimeProtectedAreaValidationResult {
  readonly clear: boolean;
  readonly conflicts: readonly RuntimeProtectedAreaConflict[];
}

export interface RuntimeProtectedRuleQueryResult {
  readonly position: readonly [number, number, number];
  readonly blocked: boolean;
  readonly areaId: string | null;
  readonly areaName: string | null;
  readonly kind: string | null;
  readonly priority: number | null;
  readonly rules: ProtectedAreaRuleMatrix;
}

export interface RuntimeProtectedAreaLoadResult {
  readonly areas: readonly ProtectedArea[];
  readonly areaCount: number;
}

export interface RuntimeLightMutationResult {
  readonly light: LightInstance;
}

export interface RuntimeLightDeleteResult {
  readonly lightId: string;
  readonly deleted: boolean;
}

export interface RuntimeLightLoadResult {
  readonly lights: readonly LightInstance[];
  readonly lightCount: number;
}

export interface RuntimePropScatterResult {
  readonly props: readonly PropInstance[];
  readonly propStats: PropStats;
}

export interface RuntimePropRemoveResult {
  readonly removedPropIds: readonly string[];
  readonly propStats: PropStats;
}

export type RuntimeTerrainPreviewResult = TerrainPreviewResult;

export interface RuntimeTerrainRecipeState {
  readonly recipe: TerrainRecipe;
  readonly fingerprint: string;
}
