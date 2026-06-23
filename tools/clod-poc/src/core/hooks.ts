export interface CamPose {
  p: [number, number, number];
  yaw: number;
  pitch: number;
  fov?: number;
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
  progress: number;
  progressMsg: string;
  setPose: ((pose: CamPose) => void) | null;
  getPose: (() => CamPose) | null;
  settle: ((frames?: number) => Promise<void>) | null;
  flyCamEnabled: ((on: boolean) => void) | null;
}

declare global {
  interface Window {
    __drusnielClod?: ClodHooks;
    __drusnielTerrainSummary?: import("../clod/terrain_summary.js").TerrainSummaryField;
  }
}

export function initHooks(): ClodHooks {
  const hooks: ClodHooks = {
    ready: false,
    error: null,
    stats: null,
    diag: null,
    progress: 0,
    progressMsg: "boot",
    setPose: null,
    getPose: null,
    settle: null,
    flyCamEnabled: null,
  };
  window.__drusnielClod = hooks;
  return hooks;
}
