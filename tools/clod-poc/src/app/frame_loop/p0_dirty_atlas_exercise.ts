import type { ClodHooks } from "../../core/hooks.js";
import type { FarSummaryTile } from "../../naadf/types.js";
import type { FramePerfProbe } from "./perf_probe.js";

export interface P0DirtyAtlasExerciseInput {
  searchParams: URLSearchParams;
  queryScene: string | null;
  camera?: unknown;
  controls?: unknown;
  perfProbe: FramePerfProbe | null;
  getHooks(): ClodHooks | null;
}

export interface P0DirtyAtlasExerciseRuntime {
  update(frameId: number): void;
}

type ExerciseStatus = "disabled" | "pending" | "settling" | "done" | "skipped";

type DirtyAtlasNaadfRuntime = {
  config: { farClipmap: { tileCells: number } };
  state: {
    farTiles: Map<string, FarSummaryTile>;
    revision: number;
  };
  getFarSummaryGpuAtlasView(): {
    valid: number;
    rings: Array<{
      valid: number;
      cellM: number;
      widthCells: number;
      heightCells: number;
      originX: number;
      originZ: number;
    }>;
  } | undefined;
};

const DEFAULT_INVALIDATED_TILES = 4;
const MAX_INVALIDATED_TILES = 8;
const DEFAULT_SETTLE_FRAMES = 18;
const STATUS_CODE: Record<ExerciseStatus, number> = {
  disabled: 0,
  pending: 1,
  settling: 2,
  done: 3,
  skipped: 4,
};

/**
 * Proves the far-summary atlas dirty-upload path during P0 runs: bumps the
 * revision of a few far tiles that are currently placed in the atlas window
 * (same slot, new revision ⇒ blit-only dirty rects), so the next atlas update
 * performs a partial upload well below the full-upload threshold. Camera
 * movement is deliberately not used — window shifts dirty ~30+ tiles and fall
 * back to a threshold full upload.
 */
export function createP0DirtyAtlasExercise(input: P0DirtyAtlasExerciseInput): P0DirtyAtlasExerciseRuntime {
  const enabled = shouldEnable(input);
  const requestedTiles = clampTiles(positiveParam(input.searchParams, "dirtyAtlasTiles") ?? DEFAULT_INVALIDATED_TILES);
  const settleFrames = Math.max(1, Math.floor(positiveParam(input.searchParams, "dirtyAtlasSettleFrames") ?? DEFAULT_SETTLE_FRAMES));
  let status: ExerciseStatus = enabled ? "pending" : "disabled";
  let settleRemaining = 0;
  let triggeredFrame = -1;
  let resetFrame = -1;
  let bumpedTiles = 0;

  const mirror = (): void => {
    const counters = input.getHooks()?.stats?.counters;
    if (!counters) return;
    counters["p0DirtyAtlasExercise.enabled"] = enabled ? 1 : 0;
    counters["p0DirtyAtlasExercise.status"] = STATUS_CODE[status];
    counters["p0DirtyAtlasExercise.requestedTiles"] = requestedTiles;
    counters["p0DirtyAtlasExercise.bumpedTiles"] = bumpedTiles;
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
      const perf = typeof window !== "undefined" ? window.__drusnielPerf : undefined;
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
          bumpedTiles = bumpPlacedFarSummaryTiles(requestedTiles);
          if (bumpedTiles > 0) {
            triggeredFrame = frameId;
            settleRemaining = settleFrames;
            status = "settling";
          }
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

/**
 * Re-stamps up to `requestedTiles` ready far tiles inside the ring-0 atlas
 * window with fresh revisions. Tiles are taken from a single tile row so the
 * merged dirty rects stay a thin strip (≤ requestedTiles · tileCells² pixels)
 * instead of a bounding box across rows.
 */
function bumpPlacedFarSummaryTiles(requestedTiles: number): number {
  const naadf = naadfRuntime();
  const view = naadf?.getFarSummaryGpuAtlasView();
  if (!naadf || !view || view.valid !== 1) return 0;
  const ring = view.rings[0];
  const tileCells = naadf.config.farClipmap.tileCells;
  if (!ring || ring.valid !== 1 || ring.cellM <= 0 || tileCells <= 0) return 0;

  const spanM = ring.cellM * tileCells;
  const tilesX = Math.max(1, Math.round(ring.widthCells / tileCells));
  const tilesZ = Math.max(1, Math.round(ring.heightCells / tileCells));
  const minTileX = Math.round(ring.originX / spanM);
  const minTileZ = Math.round(ring.originZ / spanM);

  const state = naadf.state;
  const placedByRow = new Map<number, Array<[string, FarSummaryTile]>>();
  for (const [mapKey, tile] of state.farTiles) {
    if (tile.key.ring !== 0 || tile.state !== "ready") continue;
    if (tile.key.x < minTileX || tile.key.x >= minTileX + tilesX) continue;
    if (tile.key.z < minTileZ || tile.key.z >= minTileZ + tilesZ) continue;
    let row = placedByRow.get(tile.key.z);
    if (!row) {
      row = [];
      placedByRow.set(tile.key.z, row);
    }
    row.push([mapKey, tile]);
  }

  let bestRow: Array<[string, FarSummaryTile]> | null = null;
  for (const row of placedByRow.values()) {
    if (!bestRow || row.length > bestRow.length) bestRow = row;
  }
  if (!bestRow) return 0;

  bestRow.sort(([, a], [, b]) => a.key.x - b.key.x);
  let bumped = 0;
  for (const [mapKey, tile] of bestRow) {
    if (bumped >= requestedTiles) break;
    state.farTiles.set(mapKey, { ...tile, revision: state.revision++ });
    bumped++;
  }
  return bumped;
}

function naadfRuntime(): DirtyAtlasNaadfRuntime | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { __drusnielNaadf?: DirtyAtlasNaadfRuntime }).__drusnielNaadf;
}

function clampTiles(value: number): number {
  return Math.min(MAX_INVALIDATED_TILES, Math.max(1, Math.floor(value)));
}

function positiveParam(searchParams: URLSearchParams, key: string): number | null {
  const raw = searchParams.get(key);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
