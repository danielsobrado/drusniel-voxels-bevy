// Edit commands (playable-world-contract P1.3): deny by default; no silent replay.
//
// A queued click that fires seconds later against moved terrain is a bug, not
// resilience. The default outcome for anything that cannot execute immediately is a
// denial with feedback — the player clicks again. Where retry is wanted (construction
// ghosts: the intent stays visible on screen), it is an immutable command validated at
// execution time against the LATEST terrain revision. Dig strikes and combat/spell
// casts are never replayable.

export type EditCommandOperation =
  | "terrain_dig"
  | "terrain_fill"
  | "construction_place"
  | "construction_remove"
  | "spell_cast";

export interface EditCommand {
  readonly operation: EditCommandOperation;
  readonly targetPosition: readonly [number, number, number];
  readonly targetNormal: readonly [number, number, number];
  readonly sourceTerrainRevision: number;
  readonly actor: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

export type EditCommandDenialReason =
  | "expired"
  | "revision_mismatch"
  | "out_of_range"
  | "mode_changed"
  | "target_moved"
  | "not_ready";

export type EditCommandVerdict =
  | { allowed: true }
  | { allowed: false; reason: EditCommandDenialReason };

export interface EditCommandContext {
  nowMs: number;
  currentTerrainRevision: number;
  /** Actor position at execution time; distance is re-checked, not trusted from creation. */
  actorPosition: { x: number; z: number };
  maxDistanceM: number;
  /** Current interaction/edit mode; commands created in another mode are denied. */
  currentMode: string;
  /**
   * Authority validation against the LATEST revision: the same world feature is still
   * targeted (surface still exists near targetPosition, snap point still valid, …).
   * Absent for non-replayable operations — they use strict revision equality instead.
   */
  targetStillValid?: (command: EditCommand) => boolean;
  /** Target cell readiness (edit authority resident); false denies with "not_ready". */
  targetReady?: boolean;
}

/** Only construction ghosts survive a terrain revision bump — their intent stays visible. */
export function editCommandMayRetryAcrossRevisions(operation: EditCommandOperation): boolean {
  return operation === "construction_place";
}

export const DEFAULT_EDIT_COMMAND_EXPIRY_MS = 1000;

export interface CreateEditCommandInput {
  operation: EditCommandOperation;
  targetPosition: readonly [number, number, number];
  targetNormal: readonly [number, number, number];
  sourceTerrainRevision: number;
  actor: string;
  mode: string;
  nowMs: number;
  expiryMs?: number;
}

export interface ModedEditCommand extends EditCommand {
  readonly mode: string;
}

export function createEditCommand(input: CreateEditCommandInput): ModedEditCommand {
  return Object.freeze({
    operation: input.operation,
    targetPosition: Object.freeze([...input.targetPosition]) as readonly [number, number, number],
    targetNormal: Object.freeze([...input.targetNormal]) as readonly [number, number, number],
    sourceTerrainRevision: input.sourceTerrainRevision,
    actor: input.actor,
    mode: input.mode,
    createdAtMs: input.nowMs,
    expiresAtMs: input.nowMs + (input.expiryMs ?? DEFAULT_EDIT_COMMAND_EXPIRY_MS),
  });
}

export function validateEditCommand(command: ModedEditCommand, context: EditCommandContext): EditCommandVerdict {
  if (context.nowMs > command.expiresAtMs) return { allowed: false, reason: "expired" };
  if (command.mode !== context.currentMode) return { allowed: false, reason: "mode_changed" };
  if (context.targetReady === false) return { allowed: false, reason: "not_ready" };

  const dx = context.actorPosition.x - command.targetPosition[0];
  const dz = context.actorPosition.z - command.targetPosition[2];
  if (Math.hypot(dx, dz) > context.maxDistanceM) return { allowed: false, reason: "out_of_range" };

  if (context.currentTerrainRevision !== command.sourceTerrainRevision) {
    if (!editCommandMayRetryAcrossRevisions(command.operation)) {
      return { allowed: false, reason: "revision_mismatch" };
    }
    // Replayable command under moved terrain: authority re-validation against the
    // latest revision is mandatory, not optional.
    if (!context.targetStillValid || !context.targetStillValid(command)) {
      return { allowed: false, reason: "target_moved" };
    }
  }

  return { allowed: true };
}
