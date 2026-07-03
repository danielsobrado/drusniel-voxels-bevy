import type { Page } from "playwright";

export type P0DirtyAtlasExerciseStatus = "disabled" | "pending" | "done" | "skipped" | "failed";

export interface P0DirtyAtlasExerciseConfig {
  enabled: boolean;
  moveMeters: number;
  settleFrames: number;
}

export interface P0DirtyAtlasExerciseResult {
  status: P0DirtyAtlasExerciseStatus;
  detail: string;
  before?: Record<string, number>;
  after?: Record<string, number>;
}

const DEFAULT_MOVE_METERS = 768;
const DEFAULT_SETTLE_FRAMES = 18;
const MIN_MOVE_METERS = 64;

export function createP0DirtyAtlasExerciseConfig(input: {
  enabled: boolean;
  moveMeters?: number;
  settleFrames?: number;
}): P0DirtyAtlasExerciseConfig {
  return {
    enabled: input.enabled,
    moveMeters: finitePositive(input.moveMeters) ? input.moveMeters : DEFAULT_MOVE_METERS,
    settleFrames: finitePositive(input.settleFrames) ? Math.floor(input.settleFrames) : DEFAULT_SETTLE_FRAMES,
  };
}

export function initialP0DirtyAtlasExerciseResult(config: P0DirtyAtlasExerciseConfig, scene: string | undefined): P0DirtyAtlasExerciseResult {
  if (!config.enabled) return { status: "disabled", detail: "disabled by runner config" };
  if (!scene?.includes("naadf")) return { status: "skipped", detail: `scene ${scene ?? "unknown"} is not a NAADF scene` };
  return { status: "pending", detail: "waiting for perf warmup" };
}

export function shouldRunP0DirtyAtlasExercise(input: {
  result: P0DirtyAtlasExerciseResult;
  observedFrames: number;
  warmupFrames: number;
  clodReady: boolean | null;
}): boolean {
  return input.result.status === "pending"
    && input.clodReady === true
    && input.observedFrames >= Math.max(1, input.warmupFrames);
}

export async function runP0DirtyAtlasExercise(page: Page, config: P0DirtyAtlasExerciseConfig): Promise<P0DirtyAtlasExerciseResult> {
  if (!config.enabled) return { status: "disabled", detail: "disabled by runner config" };
  return page.evaluate(async ({ moveMeters, settleFrames, minMoveMeters }) => {
    const atlasCounters = (counters: Record<string, number>): Record<string, number> => ({
      dirtyUploads: counters["naadf.farSummaryAtlas.upload.dirtyUploads"] ?? 0,
      fullUploads: counters["naadf.farSummaryAtlas.upload.fullUploads"] ?? 0,
      dirtyPixels: counters["naadf.farSummaryAtlas.upload.dirtyPixels"] ?? 0,
      totalPixels: counters["naadf.farSummaryAtlas.upload.totalPixels"] ?? 0,
      dirtyPct: counters["naadf.farSummaryAtlas.upload.dirtyPct"] ?? 0,
      modeCode: counters["naadf.farSummaryAtlas.upload.modeCode"] ?? 0,
    });
    const movedPosition = (x: number, move: number, worldCells: number): number => {
      if (!Number.isFinite(worldCells) || worldCells <= 0) return x + move;
      const maxX = worldCells * 0.9;
      const minX = worldCells * 0.1;
      const forward = Math.min(maxX, x + move);
      if (Math.abs(forward - x) >= minMoveMeters) return forward;
      return Math.max(minX, x - move);
    };

    const hooks = window.__drusnielClod;
    const perf = window.__drusnielPerf;
    if (!hooks) return { status: "skipped", detail: "missing __drusnielClod hooks" } as P0DirtyAtlasExerciseResult;
    if (!hooks.getPose || !hooks.setPose || !hooks.settle) {
      return { status: "skipped", detail: "missing getPose/setPose/settle hooks" } as P0DirtyAtlasExerciseResult;
    }
    const before = atlasCounters(hooks.stats?.counters ?? {});
    const pose = hooks.getPose();
    const worldCells = hooks.stats?.counters?.world_cells ?? 0;
    const move = Math.max(minMoveMeters, moveMeters);
    const movedX = movedPosition(pose.p[0], move, worldCells);
    const nextPose = { ...pose, p: [movedX, pose.p[1], pose.p[2]] as [number, number, number] };
    hooks.setPose(nextPose);
    await hooks.settle(settleFrames);
    const after = atlasCounters(hooks.stats?.counters ?? {});
    perf?.reset?.();
    return {
      status: "done",
      detail: `moved camera x ${pose.p[0].toFixed(2)} -> ${movedX.toFixed(2)}, settled ${settleFrames} frames, reset perf probe`,
      before,
      after,
    } as P0DirtyAtlasExerciseResult;
  }, { ...config, minMoveMeters: MIN_MOVE_METERS });
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
