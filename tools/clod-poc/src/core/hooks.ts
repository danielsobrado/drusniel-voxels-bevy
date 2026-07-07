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
  beginMovementRouteProbe: (() => void) | null;
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
    __drusnielAcceptanceWorldCacheKey?: import("../cache/acceptanceWorldCacheKey.js").AcceptanceWorldCacheKey;
    __drusnielTerrainSummary?: import("../clod/terrain_summary.js").TerrainSummaryField;
    __drusnielPhase0Report?: Phase0SceneReport;
  }
}

export function initHooks(): ClodHooks {
  const hooks: ClodHooks = {
    ready: false,
    error: null,
    stats: null,
    diag: null,
    startupTimings: window.__drusnielStartupTimings ?? null,
    progress: 0,
    progressMsg: "boot",
    setPose: null,
    getPose: null,
    settle: null,
    flyCamEnabled: null,
    beginMovementRouteProbe: null,
    setAcceptanceSceneOptions: null,
    resetAcceptanceScene: null,
    resetAcceptanceSceneForPose: null,
  };
  window.__drusnielClod = hooks;
  return hooks;
}
