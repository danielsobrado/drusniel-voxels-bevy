import type * as THREE from "three";
import type { ClodHooks } from "../../core/hooks.js";
import type { FramePerfProbe } from "./perf_probe.js";

export interface P0DirtyAtlasExerciseInput {
  searchParams: URLSearchParams;
  queryScene: string | null;
  camera: THREE.PerspectiveCamera;
  controls: { target: THREE.Vector3; update(): void };
  perfProbe: FramePerfProbe | null;
  getHooks(): ClodHooks | null;
}

export interface P0DirtyAtlasExerciseRuntime {
  update(frameId: number): void;
}

type ExerciseStatus = "disabled" | "pending" | "settling" | "done" | "skipped";

const DEFAULT_MOVE_METERS = 768;
const DEFAULT_SETTLE_FRAMES = 18;
const MIN_MOVE_METERS = 64;
const STATUS_CODE: Record<ExerciseStatus, number> = {
  disabled: 0,
  pending: 1,
  settling: 2,
  done: 3,
  skipped: 4,
};

export function createP0DirtyAtlasExercise(input: P0DirtyAtlasExerciseInput): P0DirtyAtlasExerciseRuntime {
  const enabled = shouldEnable(input);
  const moveMeters = positiveParam(input.searchParams, "dirtyAtlasMoveM") ?? DEFAULT_MOVE_METERS;
  const settleFrames = Math.max(1, Math.floor(positiveParam(input.searchParams, "dirtyAtlasSettleFrames") ?? DEFAULT_SETTLE_FRAMES));
  let status: ExerciseStatus = enabled ? "pending" : "disabled";
  let settleRemaining = 0;
  let triggeredFrame = -1;
  let resetFrame = -1;
  let moveApplied = 0;

  const mirror = (): void => {
    const counters = input.getHooks()?.stats?.counters;
    if (!counters) return;
    counters["p0DirtyAtlasExercise.enabled"] = enabled ? 1 : 0;
    counters["p0DirtyAtlasExercise.status"] = STATUS_CODE[status];
    counters["p0DirtyAtlasExercise.moveM"] = moveApplied;
    counters["p0DirtyAtlasExercise.triggeredFrame"] = triggeredFrame;
    counters["p0DirtyAtlasExercise.resetFrame"] = resetFrame;
    counters["p0DirtyAtlasExercise.settleRemaining"] = settleRemaining;
  };

  return {
    update(frameId: number): void {
      if (!enabled) {
        mirror();
        return;
      }
      const perf = window.__drusnielPerf;
      if (!perf) {
        status = "skipped";
        mirror();
        return;
      }
      if (status === "pending") {
        if (perf.ready) {
          status = "skipped";
          mirror();
          return;
        }
        if (perf.observedFrames >= Math.max(1, perf.warmupFrames)) {
          moveApplied = moveCameraAcrossAtlasTile(input, moveMeters);
          triggeredFrame = frameId;
          settleRemaining = settleFrames;
          status = "settling";
        }
        mirror();
        return;
      }
      if (status === "settling") {
        settleRemaining -= 1;
        if (settleRemaining <= 0) {
          input.perfProbe?.reset();
          resetFrame = frameId;
          status = "done";
        }
      }
      mirror();
    },
  };
}

function shouldEnable(input: P0DirtyAtlasExerciseInput): boolean {
  if (!input.perfProbe) return false;
  if (!input.queryScene?.includes("naadf")) return false;
  if (input.searchParams.get("p0DirtyAtlasExercise") === "0") return false;
  if (input.searchParams.get("dirtyAtlasExercise") === "0") return false;
  return true;
}

function moveCameraAcrossAtlasTile(input: P0DirtyAtlasExerciseInput, requestedMoveMeters: number): number {
  const move = Math.max(MIN_MOVE_METERS, requestedMoveMeters);
  const counters = input.getHooks()?.stats?.counters;
  const worldCells = counters?.world_cells ?? 0;
  const x = input.camera.position.x;
  const nextX = movedPosition(x, move, worldCells);
  const dx = nextX - x;
  input.camera.position.x += dx;
  input.controls.target.x += dx;
  input.controls.update();
  return Math.abs(dx);
}

function movedPosition(x: number, moveMeters: number, worldCells: number): number {
  if (!Number.isFinite(worldCells) || worldCells <= 0) return x + moveMeters;
  const maxX = worldCells * 0.9;
  const minX = worldCells * 0.1;
  const forward = Math.min(maxX, x + moveMeters);
  if (Math.abs(forward - x) >= MIN_MOVE_METERS) return forward;
  return Math.max(minX, x - moveMeters);
}

function positiveParam(searchParams: URLSearchParams, key: string): number | null {
  const raw = searchParams.get(key);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
