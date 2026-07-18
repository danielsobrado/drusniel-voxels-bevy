import * as THREE from "three";
import { gameplayDiagnostics, type GameplayCounterKey } from "../../player/gameplay_diagnostics.js";
import {
  createEditCommand,
  validateEditCommand,
  type EditCommandDenialReason,
  type ModedEditCommand,
} from "../../player/edit_commands.js";
import type { PlayerEditAuthorityConfig } from "../../player/player_edit_authority.js";
import type { TerrainRaycastService } from "../../player/terrain_raycast_service.js";
import { getDigEditRevision } from "../../terrain/terrain.js";
import type {
  TerrainBrushParams,
  TerrainEditService,
  TerrainSpellEditRequest,
  TerrainSpellEditResult,
} from "./terrain_edit_service.js";

const DIG_COMMAND_DEBOUNCE_MS = 40;
const MAX_SCHEDULED_DIGS_IN_PIPELINE = 2;
const TARGET_POSITION_EPSILON_M = 0.25;

interface TerrainDigIntent {
  readonly ray: THREE.Ray;
  readonly brush: Readonly<TerrainBrushParams>;
  readonly command: ModedEditCommand;
}

interface PendingScheduledDig {
  readonly ray: THREE.Ray;
  readonly brush: Readonly<TerrainBrushParams>;
  readonly mode: string;
  readonly targetPosition: readonly [number, number, number];
}

export interface TerrainEditCommandServiceDeps {
  readonly terrainRaycast: TerrainRaycastService;
  readonly getBrushParams: () => TerrainBrushParams;
  readonly editAuthority?: PlayerEditAuthorityConfig;
  readonly getAuthorityOrigin?: () => THREE.Vector3 | null;
  readonly getInteractionMode?: () => string;
  readonly getTerrainRevision?: () => number;
  readonly editReadyAt?: (x: number, z: number) => boolean;
  readonly setLastDigSummary: (summary: string) => void;
  readonly updateInfo: () => void;
  readonly nowMs?: () => number;
}

function cloneBrush(brush: TerrainBrushParams): Readonly<TerrainBrushParams> {
  return Object.freeze({ ...brush });
}

function brushIsValid(brush: TerrainBrushParams): boolean {
  return Number.isFinite(brush.digRadius)
    && brush.digRadius > 0
    && (brush.brushOp !== "add" || Number.isFinite(brush.brushMaterial))
    && Number.isFinite(brush.brushHeight)
    && Number.isFinite(brush.brushStrength)
    && Number.isFinite(brush.brushFalloff);
}

function brushesEqual(left: Readonly<TerrainBrushParams>, right: TerrainBrushParams): boolean {
  return left.digRadius === right.digRadius
    && left.brushShape === right.brushShape
    && left.brushOp === right.brushOp
    && (left.brushOp !== "add" || left.brushMaterial === right.brushMaterial)
    && left.brushHeight === right.brushHeight
    && left.brushStrength === right.brushStrength
    && left.brushFalloff === right.brushFalloff;
}

function denialCounter(reason: EditCommandDenialReason): GameplayCounterKey {
  if (reason === "expired") return "edit_commands_expired";
  if (reason === "revision_mismatch") return "edit_commands_denied_revision";
  if (reason === "out_of_range") return "edit_commands_denied_distance";
  if (reason === "mode_changed") return "edit_commands_denied_mode";
  if (reason === "target_moved") return "edit_commands_denied_target_moved";
  return "edits_denied_not_ready";
}

function targetMatches(command: ModedEditCommand, point: THREE.Vector3): boolean {
  const dx = command.targetPosition[0] - point.x;
  const dy = command.targetPosition[1] - point.y;
  const dz = command.targetPosition[2] - point.z;
  return dx * dx + dy * dy + dz * dz <= TARGET_POSITION_EPSILON_M * TARGET_POSITION_EPSILON_M;
}

export function createCommandGuardedTerrainEditService(
  base: TerrainEditService,
  deps: TerrainEditCommandServiceDeps,
): TerrainEditService {
  let operationTail: Promise<void> = Promise.resolve();
  let digDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let scheduledDigsInPipeline = 0;
  let pendingScheduledDig: PendingScheduledDig | null = null;

  const nowMs = (): number => (deps.nowMs ?? (() => performance.now()))();
  const interactionMode = (): string => deps.getInteractionMode?.() ?? "playing";
  const terrainRevision = (): number => deps.getTerrainRevision?.() ?? getDigEditRevision();

  const reportNoTarget = (): void => {
    deps.setLastDigSummary("no terrain under brush");
    deps.updateInfo();
  };

  const reportDenial = (reason: EditCommandDenialReason): void => {
    gameplayDiagnostics.add(denialCounter(reason));
    deps.setLastDigSummary(`terrain edit rejected: ${reason}`);
    deps.updateInfo();
  };

  const captureImmediateIntent = (ray: THREE.Ray): TerrainDigIntent | null => {
    try {
      const frozenRay = ray.clone();
      const hit = deps.terrainRaycast.raycastEditableTerrain(frozenRay);
      if (!hit) {
        reportNoTarget();
        return null;
      }
      const brush = deps.getBrushParams();
      const capturedAt = nowMs();
      const revision = terrainRevision();
      const mode = interactionMode();
      if (
        !brushIsValid(brush)
        || !Number.isFinite(capturedAt)
        || !Number.isSafeInteger(revision)
        || mode.length === 0
        || !Number.isFinite(hit.point.x)
        || !Number.isFinite(hit.point.y)
        || !Number.isFinite(hit.point.z)
      ) {
        reportDenial("not_ready");
        return null;
      }
      return {
        ray: frozenRay,
        brush: cloneBrush(brush),
        command: createEditCommand({
          operation: brush.brushOp === "add" ? "terrain_fill" : "terrain_dig",
          targetPosition: [hit.point.x, hit.point.y, hit.point.z],
          targetNormal: [0, 1, 0],
          sourceTerrainRevision: revision,
          actor: "player",
          mode,
          nowMs: capturedAt,
        }),
      };
    } catch (error) {
      console.error("[terrain-edit-command] intent capture failed closed", error);
      reportDenial("not_ready");
      return null;
    }
  };

  const materializeScheduledIntent = (pending: PendingScheduledDig): TerrainDigIntent | null => {
    try {
      const capturedAt = nowMs();
      const revision = terrainRevision();
      if (!Number.isFinite(capturedAt) || !Number.isSafeInteger(revision)) {
        reportDenial("not_ready");
        return null;
      }
      return {
        ray: pending.ray.clone(),
        brush: pending.brush,
        command: createEditCommand({
          operation: pending.brush.brushOp === "add" ? "terrain_fill" : "terrain_dig",
          targetPosition: pending.targetPosition,
          targetNormal: [0, 1, 0],
          sourceTerrainRevision: revision,
          actor: "player",
          mode: pending.mode,
          nowMs: capturedAt,
        }),
      };
    } catch (error) {
      console.error("[terrain-edit-command] scheduled intent materialize failed closed", error);
      reportDenial("not_ready");
      return null;
    }
  };

  const validateIntent = (intent: TerrainDigIntent): EditCommandDenialReason | null => {
    try {
      const point = new THREE.Vector3(...intent.command.targetPosition);
      const origin = deps.getAuthorityOrigin?.() ?? null;
      const allowFarCommit = deps.editAuthority?.allowFarCommit ?? false;
      if (!origin && !allowFarCommit) return "not_ready";
      const actor = origin ?? point;
      const maxDistanceM = allowFarCommit
        ? Number.MAX_SAFE_INTEGER
        : deps.editAuthority?.terrainEditRadiusM ?? Number.MAX_SAFE_INTEGER;
      const currentNowMs = nowMs();
      const currentRevision = terrainRevision();
      const currentMode = interactionMode();
      if (
        !Number.isFinite(actor.x)
        || !Number.isFinite(actor.z)
        || !Number.isFinite(maxDistanceM)
        || maxDistanceM < 0
        || !Number.isFinite(currentNowMs)
        || !Number.isSafeInteger(currentRevision)
        || currentMode.length === 0
      ) return "not_ready";
      const verdict = validateEditCommand(intent.command, {
        nowMs: currentNowMs,
        currentTerrainRevision: currentRevision,
        actorPosition: actor,
        maxDistanceM,
        currentMode,
        targetReady: deps.editReadyAt?.(point.x, point.z) ?? true,
      });
      if (!verdict.allowed) return verdict.reason;
      const brush = deps.getBrushParams();
      if (!brushIsValid(brush) || !brushesEqual(intent.brush, brush)) return "not_ready";
      const currentHit = deps.terrainRaycast.raycastEditableTerrain(intent.ray);
      if (!currentHit || !targetMatches(intent.command, currentHit.point)) return "target_moved";
      return null;
    } catch (error) {
      console.error("[terrain-edit-command] intent validation failed closed", error);
      return "not_ready";
    }
  };

  const executeIntent = async (intent: TerrainDigIntent): Promise<void> => {
    const denial = validateIntent(intent);
    if (denial) {
      reportDenial(denial);
      return;
    }
    await base.runDigNow(intent.ray, {
      brush: intent.brush,
      targetPoint: new THREE.Vector3(...intent.command.targetPosition),
    });
  };

  const enqueueOperation = <T>(label: string, operation: () => Promise<T>): Promise<T> => {
    const queued = operationTail.then(operation, operation);
    operationTail = queued.then(() => undefined, (error) => {
      const message = error instanceof Error ? error.message : String(error);
      deps.setLastDigSummary(`${label} failed: ${message}`);
      deps.updateInfo();
      console.error(`[terrain-edit-command] ${label} failed`, error);
    });
    return queued;
  };

  const runDigNow = async (ray: THREE.Ray): Promise<void> => {
    const intent = captureImmediateIntent(ray);
    if (!intent) return;
    await enqueueOperation("terrain brush", () => executeIntent(intent));
  };

  const fireScheduledDig = (): void => {
    digDebounceTimer = null;
    if (scheduledDigsInPipeline >= MAX_SCHEDULED_DIGS_IN_PIPELINE) return;
    const pending = pendingScheduledDig;
    pendingScheduledDig = null;
    if (!pending) return;
    scheduledDigsInPipeline += 1;
    // Materialize revision when the queued operation runs so own prior digs do not
    // trip revision_mismatch. Brush/mode/target stay frozen from the latest schedule.
    void enqueueOperation("terrain brush", async () => {
      const intent = materializeScheduledIntent(pending);
      if (!intent) return;
      await executeIntent(intent);
    }).then(
      () => { scheduledDigsInPipeline -= 1; },
      () => { scheduledDigsInPipeline -= 1; },
    );
  };

  const scheduleDig = (ray: THREE.Ray): void => {
    if (scheduledDigsInPipeline >= MAX_SCHEDULED_DIGS_IN_PIPELINE && digDebounceTimer === null) return;
    try {
      const frozenRay = ray.clone();
      const hit = deps.terrainRaycast.raycastEditableTerrain(frozenRay);
      if (!hit) {
        reportNoTarget();
        return;
      }
      const brush = deps.getBrushParams();
      const mode = interactionMode();
      if (
        !brushIsValid(brush)
        || mode.length === 0
        || !Number.isFinite(hit.point.x)
        || !Number.isFinite(hit.point.y)
        || !Number.isFinite(hit.point.z)
      ) {
        reportDenial("not_ready");
        return;
      }
      pendingScheduledDig = {
        ray: frozenRay,
        brush: cloneBrush(brush),
        mode,
        targetPosition: [hit.point.x, hit.point.y, hit.point.z],
      };
    } catch (error) {
      console.error("[terrain-edit-command] schedule capture failed closed", error);
      reportDenial("not_ready");
      return;
    }
    if (digDebounceTimer !== null) return;
    digDebounceTimer = setTimeout(fireScheduledDig, DIG_COMMAND_DEBOUNCE_MS);
  };

  const commitSpellTerrainEdit = (
    request: TerrainSpellEditRequest,
    onAuthoritativeCommit?: () => void,
  ): Promise<TerrainSpellEditResult> => enqueueOperation(
    `spell:${request.spellId}`,
    () => base.commitSpellTerrainEdit(request, onAuthoritativeCommit),
  );

  return {
    scheduleDig,
    runDigNow,
    commitSpellTerrainEdit,
    scheduleConstructionTerrainConform: (request) => {
      void enqueueOperation(
        "construction terrain conform",
        async () => { await base.commitConstructionTerrainConform(request); },
      );
    },
    previewConstructionTerrainConform: (request) => base.previewConstructionTerrainConform(request),
    commitConstructionTerrainConform: (request) => enqueueOperation(
      "construction terrain conform",
      () => base.commitConstructionTerrainConform(request),
    ),
    undoConstructionTerrainConform: (receipt) => enqueueOperation(
      "construction terrain undo",
      () => base.undoConstructionTerrainConform(receipt),
    ),
    forgetConstructionTerrainConform: (receipt) => base.forgetConstructionTerrainConform(receipt),
    flushAncestors: async () => {
      await operationTail;
      await base.flushAncestors();
    },
    get lastDigAt() { return base.lastDigAt; },
  };
}
