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
const TARGET_POSITION_EPSILON_M = 0.25;

interface TerrainDigIntent {
  readonly ray: THREE.Ray;
  readonly brush: Readonly<TerrainBrushParams>;
  readonly command: ModedEditCommand;
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
    && Number.isFinite(brush.brushMaterial)
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

  const captureIntent = (ray: THREE.Ray): TerrainDigIntent | null => {
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
        || !hit.point.toArray().every(Number.isFinite)
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

  const validateIntent = (intent: TerrainDigIntent): EditCommandDenialReason | null => {
    try {
      const point = new THREE.Vector3(...intent.command.targetPosition);
      const actor = deps.getAuthorityOrigin?.() ?? point;
      const maxDistanceM = deps.editAuthority?.allowFarCommit
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
      if (!brushIsValid(brush) || !brushesEqual(intent.brush, brush)) return "target_moved";
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
    await base.runDigNow(intent.ray);
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
    const intent = captureIntent(ray);
    if (!intent) return;
    await enqueueOperation("terrain brush", () => executeIntent(intent));
  };

  const scheduleDig = (ray: THREE.Ray): void => {
    if (digDebounceTimer !== null) return;
    const intent = captureIntent(ray);
    if (!intent) return;
    digDebounceTimer = setTimeout(() => {
      digDebounceTimer = null;
      void enqueueOperation("terrain brush", () => executeIntent(intent));
    }, DIG_COMMAND_DEBOUNCE_MS);
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
