import {
  createEditCommand,
  validateEditCommand,
  type EditCommandDenialReason,
  type EditCommandVerdict,
  type ModedEditCommand,
} from "../player/edit_commands.js";

export interface ConstructionRemoveTarget {
  readonly id: string;
  readonly position: readonly [number, number, number];
}

export interface ConstructionRemoveAuthorityDeps {
  getActorPosition(): { x: number; z: number } | null;
  getCurrentMode(): string;
  getTerrainRevision(): number;
  getMaxDistanceM(): number;
  targetReadyAt?(x: number, z: number): boolean;
  nowMs?: () => number;
  onDenied?: (reason: EditCommandDenialReason, target: ConstructionRemoveTarget) => void;
}

export type ConstructionRemoveAuthorizer = (
  target: ConstructionRemoveTarget,
  command?: ModedEditCommand | null,
) => EditCommandVerdict;

let activeAuthorizer: ConstructionRemoveAuthorizer | null = null;

function denied(
  deps: ConstructionRemoveAuthorityDeps,
  target: ConstructionRemoveTarget,
  reason: EditCommandDenialReason,
): EditCommandVerdict {
  try {
    deps.onDenied?.(reason, target);
  } catch (error) {
    console.error("[construction] remove denial callback failed", error);
  }
  return { allowed: false, reason };
}

export function createConstructionRemoveAuthorizer(
  deps: ConstructionRemoveAuthorityDeps,
): ConstructionRemoveAuthorizer {
  return (target, existingCommand = null) => {
    try {
      const nowMs = (deps.nowMs ?? (() => performance.now()))();
      const terrainRevision = deps.getTerrainRevision();
      const mode = deps.getCurrentMode();
      const actorPosition = deps.getActorPosition() ?? {
        x: target.position[0],
        z: target.position[2],
      };
      const command = existingCommand ?? createEditCommand({
        operation: "construction_remove",
        targetPosition: target.position,
        targetNormal: [0, 1, 0],
        sourceTerrainRevision: terrainRevision,
        actor: "player",
        mode,
        nowMs,
      });
      const verdict = validateEditCommand(command, {
        nowMs,
        currentTerrainRevision: terrainRevision,
        actorPosition,
        maxDistanceM: deps.getMaxDistanceM(),
        currentMode: mode,
        targetReady: deps.targetReadyAt?.(target.position[0], target.position[2]) ?? true,
      });
      return verdict.allowed ? verdict : denied(deps, target, verdict.reason);
    } catch (error) {
      console.error("[construction] remove authority failed closed", error);
      return denied(deps, target, "not_ready");
    }
  };
}

export function installConstructionRemoveAuthorizer(
  authorizer: ConstructionRemoveAuthorizer,
): () => void {
  const previous = activeAuthorizer;
  activeAuthorizer = authorizer;
  return () => {
    if (activeAuthorizer === authorizer) activeAuthorizer = previous;
  };
}

export function authorizeConstructionRemoval(
  target: ConstructionRemoveTarget,
  command?: ModedEditCommand | null,
): EditCommandVerdict {
  return activeAuthorizer?.(target, command) ?? { allowed: true };
}
