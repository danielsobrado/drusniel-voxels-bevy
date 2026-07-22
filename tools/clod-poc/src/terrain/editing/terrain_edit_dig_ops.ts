import * as THREE from "three";
import { emitAudio } from "../../audio/index.js";
import {
  applyDigEditTransaction,
  hasPaintedTerrainEdits,
  rollbackDigEditTransaction,
  voxelTransactionFromDigEdit,
  type DigEdit,
  type VoxelEditTransaction,
} from "../../terrain/terrain.js";
import type { TerrainRaycastService } from "../../player/terrain_raycast_service.js";
import { gameplayDiagnostics } from "../../player/gameplay_diagnostics.js";
import { DEFAULT_EDIT_COMMAND_EXPIRY_MS } from "../../player/edit_commands.js";
import type { TerrainBrushParams, TerrainDigExecution } from "./terrain_edit_service.js";

const DIG_REBUILD_DEBOUNCE_MS = 40;
const MAX_PENDING_DIG_SAMPLES = 32;

export type TerrainEditCommitStatus = "committed" | "committed_render_stale" | "rejected";

export interface TerrainEditDigOpsDeps {
  terrainRaycast: TerrainRaycastService;
  getBrushParams: () => TerrainBrushParams;
  setLastDigSummary: (summary: string) => void;
  updateInfo: () => void;
  terrainCommitAllowed: (point: THREE.Vector3) => boolean;
  performEditRebuild: (
    edit: DigEdit,
    transaction: VoxelEditTransaction,
    hit: { point: THREE.Vector3 },
    radius: number,
    label: string,
  ) => Promise<TerrainEditCommitStatus>;
  enqueueEditOperation: <T>(label: string, operation: () => Promise<T>) => Promise<T>;
  syncPaintedTerrainState: (previous: boolean) => void;
}

export interface TerrainEditDigOps {
  scheduleDig(ray: THREE.Ray): void;
  runDigExclusive(ray: THREE.Ray, execution?: TerrainDigExecution): Promise<void>;
}

export function createTerrainEditDigOps(deps: TerrainEditDigOpsDeps): TerrainEditDigOps {
  let digDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let digInFlight = false;
  const queuedDigRays: Array<{ ray: THREE.Ray; enqueuedAtMs: number; execution?: TerrainDigExecution }> = [];
  let scheduledDigRay: THREE.Ray | null = null;

  const performDig = async (ray: THREE.Ray, execution?: TerrainDigExecution) => {
    const hitPoint = execution?.targetPoint?.clone() ?? null;
    const hit = hitPoint
      ? { point: hitPoint, distance: 0, pageId: "command-target" }
      : deps.terrainRaycast.raycastEditableTerrain(ray);
    if (!hit) { deps.setLastDigSummary("no terrain under brush"); deps.updateInfo(); return; }
    if (!deps.terrainCommitAllowed(hit.point)) return;
    const brush = execution?.brush ? { ...execution.brush } : deps.getBrushParams();
    const edit: DigEdit = {
      x: hit.point.x, y: hit.point.y, z: hit.point.z, r: brush.digRadius,
      shape: brush.brushShape, op: brush.brushOp,
      material: brush.brushOp === "add" ? brush.brushMaterial : undefined,
      height: brush.brushHeight, strength: brush.brushStrength, falloff: brush.brushFalloff,
    };
    const transaction = voxelTransactionFromDigEdit(edit);
    if (transaction.deltas.length === 0) { deps.setLastDigSummary("no terrain changed"); deps.updateInfo(); return; }
    const hadPaintedTerrain = hasPaintedTerrainEdits();
    applyDigEditTransaction(transaction, edit);
    emitAudio(brush.brushOp === "add" ? "terrain.raise" : "terrain.dig.tick");
    const status = await deps.performEditRebuild(edit, transaction, hit, brush.digRadius, `${brush.brushOp} ${brush.brushShape}`);
    if (status === "rejected") rollbackDigEditTransaction(transaction);
    deps.syncPaintedTerrainState(hadPaintedTerrain);
    deps.updateInfo();
  };

  const runDigExclusive = async (ray: THREE.Ray, execution?: TerrainDigExecution): Promise<void> => {
    if (digInFlight) {
      const previous = queuedDigRays[queuedDigRays.length - 1];
      if (!previous || previous.ray.origin.distanceTo(ray.origin) > 0.25 || previous.ray.direction.distanceTo(ray.direction) > 0.01) {
        queuedDigRays.push({ ray: ray.clone(), enqueuedAtMs: performance.now(), execution });
        if (queuedDigRays.length > MAX_PENDING_DIG_SAMPLES) queuedDigRays.shift();
      }
      return;
    }
    digInFlight = true;
    try { await deps.enqueueEditOperation("terrain brush", () => performDig(ray, execution)); }
    finally {
      digInFlight = false;
      let next = queuedDigRays.shift() ?? null;
      while (next && performance.now() - next.enqueuedAtMs > DEFAULT_EDIT_COMMAND_EXPIRY_MS) {
        gameplayDiagnostics.add("edit_commands_expired");
        next = queuedDigRays.shift() ?? null;
      }
      if (next) void runDigExclusive(next.ray, next.execution);
    }
  };

  const scheduleDig = (ray: THREE.Ray): void => {
    scheduledDigRay = ray.clone();
    if (digDebounceTimer !== null) return;
    digDebounceTimer = setTimeout(() => {
      digDebounceTimer = null;
      const next = scheduledDigRay;
      scheduledDigRay = null;
      if (next) void runDigExclusive(next);
    }, DIG_REBUILD_DEBOUNCE_MS);
  };

  return { scheduleDig, runDigExclusive };
}
