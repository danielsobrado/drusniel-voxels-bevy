import { installBrowserQaHook } from "../qa/unified/browser_hook.js";
import type { WorldManifest } from "../world/world_manifest.js";
import type { ClodHooks, GpuDiagnostics } from "./hook_types.js";

export * from "./hook_types.js";

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
    getCameraMatrices: null,
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
    probeEarthSpellTarget: null,
    getStreamingRootReadyPageKeys: null,
    compareStreamRootBuilds: null,
    probeStreamRootHeights: null,
    getStreamingResidencySnapshot: null,
    setPrecisionLandmarks: null,
    getPrecisionLandmarkScreenPositions: null,
    teleportGameplayTarget: null,
    setTerrainStreamingEnabled: null,
    findContinentRiverCrossingRoute: null,
    setAcceptanceSceneOptions: null,
    setQaDiagnosticBuffer: null,
    resetAcceptanceScene: null,
    resetAcceptanceSceneForPose: null,
  };
  window.__drusnielClod = hooks;
  installBrowserQaHook();
  return hooks;
}
