import type { ConstructionCandidate } from "./types.js";
import {
  canCommitBuild,
  publishPlayerEditAuthorityDecision,
  type PlayerEditAuthorityConfig,
  type PlayerEditAuthorityPoint,
} from "../player/player_edit_authority.js";
import {
  createEditCommand,
  validateEditCommand,
  type EditCommandDenialReason,
  type ModedEditCommand,
} from "../player/edit_commands.js";
import { getDigEditRevision } from "../terrain/terrain_edits.js";

export function applyConstructionCommitAuthority(opts: {
  candidate: ConstructionCandidate;
  editAuthority?: PlayerEditAuthorityConfig;
  getAuthorityOrigin?: () => PlayerEditAuthorityPoint | null;
  getAuthorityCounters?: () => Record<string, number> | null;
  constructionReadyAt?: (x: number, z: number) => boolean;
}): ConstructionCandidate {
  const { editAuthority } = opts;
  let next = opts.candidate;
  if (editAuthority) {
    const decision = canCommitBuild(editAuthority, opts.getAuthorityOrigin?.() ?? null, next.position);
    publishPlayerEditAuthorityDecision(opts.getAuthorityCounters?.() ?? null, decision);
    if (!decision.allowed) {
      next = { ...next, valid: false, reason: decision.reason };
    }
  }
  if (next.valid && opts.constructionReadyAt) {
    const ready = opts.constructionReadyAt(next.position[0], next.position[2]);
    if (!ready) {
      next = { ...next, valid: false, reason: "construction not ready (terrain collider rebuilding)" };
    }
  }
  return next;
}

export function validateConstructionPlaceCommand(opts: {
  candidate: ConstructionCandidate;
  command: ModedEditCommand | null;
  getTerrainRevision?: () => number;
  getInteractionMode?: () => string;
  getAuthorityOrigin?: () => PlayerEditAuthorityPoint | null;
  editAuthority?: PlayerEditAuthorityConfig;
  constructionReadyAt?: (x: number, z: number) => boolean;
  recordEditDenial?: (reason: EditCommandDenialReason) => void;
}): { allowed: true; command: ModedEditCommand } | { allowed: false; reason: string } {
  const nowMs = performance.now();
  const currentTerrainRevision = opts.getTerrainRevision?.() ?? getDigEditRevision();
  const currentMode = opts.getInteractionMode?.() ?? "playing";
  const active = opts.command ?? createEditCommand({
    operation: "construction_place",
    targetPosition: opts.candidate.position,
    targetNormal: opts.candidate.terrainHit?.normal ?? [0, 1, 0],
    sourceTerrainRevision: currentTerrainRevision,
    actor: "player",
    mode: currentMode,
    nowMs,
  });
  const origin = opts.getAuthorityOrigin?.() ?? {
    x: opts.candidate.position[0],
    z: opts.candidate.position[2],
  };
  const maxDistanceM = opts.editAuthority?.buildCommitRadiusM ?? Number.MAX_SAFE_INTEGER;
  const verdict = validateEditCommand(active, {
    nowMs,
    currentTerrainRevision,
    actorPosition: origin,
    maxDistanceM,
    currentMode,
    targetReady: opts.constructionReadyAt?.(opts.candidate.position[0], opts.candidate.position[2]) ?? true,
    targetValidatedAtTerrainRevision: currentTerrainRevision,
    targetStillValid: (cmd) => {
      const dx = Math.abs(cmd.targetPosition[0] - opts.candidate.position[0]);
      const dy = Math.abs(cmd.targetPosition[1] - opts.candidate.position[1]);
      const dz = Math.abs(cmd.targetPosition[2] - opts.candidate.position[2]);
      return opts.candidate.valid && dx <= 0.25 && dy <= 0.5 && dz <= 0.25;
    },
  });
  if (!verdict.allowed) {
    opts.recordEditDenial?.(verdict.reason);
    return { allowed: false, reason: `edit command denied: ${verdict.reason}` };
  }
  return { allowed: true, command: active };
}
