import type { RenderQualityPreset, Selection, ViewportOverlayState } from "../types/editor";
import type {
  BlockType,
  BlockAtlasMap,
  ChunkSummary,
  MockWaterRuntimeSnapshot,
  PropInstance,
  PropStats,
  ProtectedArea,
  ProtectedAreaRuleMatrix,
  WaterBody,
  WaterReflectionDebugViewMode,
  WaterReflectionStatus,
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

export interface RuntimeWaterVisualProbeResult extends MockWaterRuntimeSnapshot {
  readonly capturedAt: string;
}

export interface RuntimeAtlasMappingState {
  readonly mapping: BlockAtlasMap;
  readonly dirty: boolean;
  readonly savedAt?: string;
}

export type RuntimeViewportDebugState = ViewportOverlayState;

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
  readonly propStats: RuntimePropStats;
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

export interface RuntimeWaterBodyMutationResult {
  readonly waterBody: Partial<WaterBody> & Pick<WaterBody, "id" | "kind" | "reflectionStrength" | "fresnelPower" | "distortionStrength">;
}

export interface RuntimeSaveSummary {
  readonly worldId: string;
  readonly savedAt: string;
  readonly snapshotId?: string;
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

export interface RuntimePropScatterResult {
  readonly props: readonly PropInstance[];
  readonly propStats: PropStats;
}

export interface RuntimePropRemoveResult {
  readonly removedPropIds: readonly string[];
  readonly propStats: PropStats;
}
