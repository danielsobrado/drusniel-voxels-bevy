import { installBrowserQaHook } from "../qa/unified/browser_hook.js";
import type { PlayableSliceSnapshot } from "../qa/playable_slice_snapshot.js";
import type { WorldManifest } from "../world/world_manifest.js";
import type {
  ContinentRiverCrossingRoute,
  ContinentRiverRouteSearchOptions,
} from "../water/continent_river_route.js";

export interface CamPose {
  p: [number, number, number];
  yaw: number;
  pitch: number;
  fov?: number;
}

export interface AcceptanceSceneOptions {
  freeze?: boolean;
  proceduralDebug?: string | null;
}

export interface TerrainEditProbeResult {
  readonly editRevision: number;
  readonly voxelDeltaCount: number;
  readonly dirtyRevision: number;
  readonly streamInvalidations: number;
  readonly streamRebuilds: number;
}

export interface EditRayInput {
  readonly origin: [number, number, number];
  readonly direction: [number, number, number];
}

export interface DestroyEnvironmentalPropInput {
  readonly position: readonly [number, number, number];
  readonly prefabId?: string;
  readonly layer?: "tree" | "stone" | "grass";
  readonly candidateSpacingM?: number;
  /** When false, skips immediate durable flush (caller must flushSaveRuntime). Default true. */
  readonly flush?: boolean;
}

export interface DestroyEnvironmentalPropResult {
  readonly ok: boolean;
  readonly propId: string | null;
  readonly dirtyRegions: readonly string[];
  readonly reason: string | null;
}

export interface FellTreeInput {
  readonly position: readonly [number, number, number];
  readonly candidateSpacingM?: number;
  readonly maxDistanceM?: number;
  /** When false, skips immediate durable flush (caller must flushSaveRuntime). Default true. */
  readonly flush?: boolean;
}

export interface FellTreeResult {
  readonly ok: boolean;
  readonly propId: string | null;
  readonly falling: boolean;
  readonly dirtyRegions: readonly string[];
  readonly reason: string | null;
}

export interface PlaceConstructionPieceInput {
  readonly position: readonly [number, number, number];
  readonly typeId?: string;
  readonly rotationQuarterTurns?: number;
  readonly material?: string;
}

export interface PlaceConstructionPieceResult {
  readonly ok: boolean;
  readonly pieceId: string | null;
  readonly reason: string | null;
}

export interface BreakConstructionPieceInput {
  readonly pieceId?: string;
  readonly position?: readonly [number, number, number];
  readonly maxDistanceM?: number;
}

export interface BreakConstructionPieceResult {
  readonly ok: boolean;
  readonly pieceId: string | null;
  readonly reason: string | null;
}

export interface PlacedConstructionPieceHookInfo {
  readonly id: string;
  readonly typeId: string;
  readonly position: readonly [number, number, number];
}

export interface EnvironmentalPropExclusionQuery {
  readonly position: readonly [number, number, number];
  readonly layer?: "tree" | "stone" | "grass";
  readonly candidateSpacingM?: number;
}

export interface EnvironmentalPropExclusionResult {
  readonly propId: string;
  readonly excluded: boolean;
  readonly address: {
    readonly tileKey: { readonly x: number; readonly z: number };
    readonly layer: "tree" | "stone" | "grass";
    readonly candidateIndex: number;
  };
}

export interface StreamingResidencySnapshot {
  readonly clodCachedKeys: readonly string[];
  readonly farSummaryResidentKeys: readonly string[];
  readonly heightfieldResidentKeys: readonly string[];
  readonly vegetationClusterKeys: readonly string[] | null;
  readonly waterHydrologyKeys: readonly string[] | null;
}

export interface StreamRootBuildLegEvidence {
  readonly ok: boolean;
  readonly error: string | null;
  readonly triangles: number;
  readonly vertices: number;
  readonly minY: number | null;
  readonly maxY: number | null;
  readonly buildMs: number;
}

export interface StreamRootBuildComparison {
  readonly id: string;
  readonly gpu: StreamRootBuildLegEvidence;
  readonly cpu: StreamRootBuildLegEvidence;
}

export interface PrecisionLandmark {
  readonly id: string;
  readonly p: readonly [number, number, number];
  readonly color?: string;
  readonly radiusM?: number;
}

export interface PrecisionLandmarkScreenPosition {
  readonly id: string;
  readonly xPx: number;
  readonly yPx: number;
  readonly depthNdc: number;
  readonly visible: boolean;
}

export interface GameplayTeleportTarget {
  readonly x: number;
  readonly z: number;
  readonly yaw?: number;
  readonly timeoutMs?: number;
}

export interface GameplayTeleportEvidence {
  readonly timeToGameplayReadyMs: number;
  readonly readinessPolls: number;
}

export interface EngineStats {
  fps: number;
  frameMs: number;
  frameMsP95: number;
  drawCalls: number;
  triangles: number;
  frame: number;
  counters: Record<string, number>;
  gpuPasses: Record<string, number>;
}

export interface GpuDiagnostics {
  ok: boolean;
  reason?: string;
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
  features: string[];
  limits: Record<string, number>;
  readonly worldManifest?: WorldManifest;
}

export interface ClodHooks {
  ready: boolean;
  error: string | null;
  stats: EngineStats | null;
  diag: GpuDiagnostics | null;
  startupTimings: Record<string, number> | null;
  progress: number;
  progressMsg: string;
  setPose: ((pose: CamPose) => void) | null;
  getPose: (() => CamPose) | null;
  settle: ((frames?: number) => Promise<void>) | null;
  flyCamEnabled: ((on: boolean) => void) | null;
  recoverAfterDeviceLoss: (() => Promise<void>) | null;
  destroyRendererDevice: (() => void) | null;
  beginMovementRouteProbe: (() => void) | null;
  runTerrainEditProbe: ((ray: EditRayInput) => Promise<TerrainEditProbeResult>) | null;
  scheduleDig: ((ray: EditRayInput) => void) | null;
  destroyEnvironmentalProp: ((input: DestroyEnvironmentalPropInput) => Promise<DestroyEnvironmentalPropResult>) | null;
  fellTree: ((input: FellTreeInput) => Promise<FellTreeResult>) | null;
  placeConstructionPiece: ((input: PlaceConstructionPieceInput) => Promise<PlaceConstructionPieceResult>) | null;
  breakConstructionPiece: ((input: BreakConstructionPieceInput) => BreakConstructionPieceResult) | null;
  listPlacedConstructionPieces: ((limit?: number) => readonly PlacedConstructionPieceHookInfo[]) | null;
  queryEnvironmentalPropExclusion: ((input: EnvironmentalPropExclusionQuery) => EnvironmentalPropExclusionResult | null) | null;
  flushSaveRuntime: (() => Promise<void>) | null;
  getPlayableSliceSnapshot: (() => PlayableSliceSnapshot) | null;
  getStreamingRootReadyPageKeys: (() => readonly string[]) | null;
  compareStreamRootBuilds: ((
    coords: readonly { px: number; pz: number; level?: number }[],
  ) => Promise<readonly StreamRootBuildComparison[]>) | null;
  getStreamingResidencySnapshot: (() => StreamingResidencySnapshot) | null;
  setPrecisionLandmarks: ((landmarks: readonly PrecisionLandmark[]) => void) | null;
  getPrecisionLandmarkScreenPositions: (() => readonly PrecisionLandmarkScreenPosition[]) | null;
  teleportGameplayTarget: ((target: GameplayTeleportTarget) => Promise<GameplayTeleportEvidence>) | null;
  setTerrainStreamingEnabled: ((enabled: boolean) => void) | null;
  findContinentRiverCrossingRoute: ((
    options?: ContinentRiverRouteSearchOptions,
  ) => ContinentRiverCrossingRoute | null) | null;
  setAcceptanceSceneOptions: ((options: AcceptanceSceneOptions) => void) | null;
  resetAcceptanceScene: (() => void) | null;
  resetAcceptanceSceneForPose: ((pose: CamPose) => void) | null;
}

export interface Phase0SceneReport {
  scene: string;
  config_hash: string;
  timestamp: string;
  metrics: Record<string, number | boolean>;
  required_counters_present: boolean;
  missing_counters: string[];
}

declare global {
  interface Window {
    __drusnielClod?: ClodHooks;
    __drusnielStartupTimings?: Record<string, number>;
    __drusnielWorldMode?: import("../app/world_mode.js").WorldModeConfig;
    __drusnielWorldManifest?: WorldManifest;
    __drusnielFarOwnership?: import("../app/far_ownership.js").FarOwnershipSummary;
    __drusnielAcceptanceWorldCacheKey?: import("../cache/acceptanceWorldCacheKey.js").AcceptanceWorldCacheKey;
    __drusnielTerrainSummary?: import("../clod/terrain_summary.js").TerrainSummaryField;
    __drusnielPhase0Report?: Phase0SceneReport;
  }
}

function attachWorldManifest(
  diagnostics: GpuDiagnostics | null,
  manifest: WorldManifest | undefined,
): void {
  if (!diagnostics || !manifest || diagnostics.worldManifest === manifest) return;
  Object.defineProperty(diagnostics, "worldManifest", {
    value: manifest,
    enumerable: true,
    configurable: true,
    writable: false,
  });
}

function manifestOnlyDiagnostics(manifest: WorldManifest | undefined): GpuDiagnostics | null {
  if (!manifest) return null;
  const diagnostics: GpuDiagnostics = {
    ok: true,
    reason: "world manifest initialized",
    features: [],
    limits: {},
  };
  attachWorldManifest(diagnostics, manifest);
  return diagnostics;
}

export function publishWorldManifestForDiagnostics(manifest: WorldManifest): void {
  window.__drusnielWorldManifest = manifest;
  attachWorldManifest(window.__drusnielClod?.diag ?? null, manifest);
}

export function initHooks(): ClodHooks {
  let diagnostics: GpuDiagnostics | null = manifestOnlyDiagnostics(
    window.__drusnielWorldManifest,
  );
  const hooks: ClodHooks = {
    ready: false,
    error: null,
    stats: null,
    get diag() {
      return diagnostics;
    },
    set diag(value) {
      diagnostics = value;
      attachWorldManifest(diagnostics, window.__drusnielWorldManifest);
    },
    startupTimings: window.__drusnielStartupTimings ?? null,
    progress: 0,
    progressMsg: "boot",
    setPose: null,
    getPose: null,
    settle: null,
    flyCamEnabled: null,
    recoverAfterDeviceLoss: null,
    destroyRendererDevice: null,
    beginMovementRouteProbe: null,
    runTerrainEditProbe: null,
    scheduleDig: null,
    destroyEnvironmentalProp: null,
    fellTree: null,
    placeConstructionPiece: null,
    breakConstructionPiece: null,
    listPlacedConstructionPieces: null,
    queryEnvironmentalPropExclusion: null,
    flushSaveRuntime: null,
    getPlayableSliceSnapshot: null,
    getStreamingRootReadyPageKeys: null,
    compareStreamRootBuilds: null,
    getStreamingResidencySnapshot: null,
    setPrecisionLandmarks: null,
    getPrecisionLandmarkScreenPositions: null,
    teleportGameplayTarget: null,
    setTerrainStreamingEnabled: null,
    findContinentRiverCrossingRoute: null,
    setAcceptanceSceneOptions: null,
    resetAcceptanceScene: null,
    resetAcceptanceSceneForPose: null,
  };
  window.__drusnielClod = hooks;
  installBrowserQaHook();
  return hooks;
}
