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

interface InstalledAuthorizer {
  readonly token: symbol;
  readonly authorizer: ConstructionRemoveAuthorizer;
}

const installedAuthorizers: InstalledAuthorizer[] = [];

function activeAuthorizer(): ConstructionRemoveAuthorizer | null {
  return installedAuthorizers[installedAuthorizers.length - 1]?.authorizer ?? null;
}

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

function targetIsFinite(target: ConstructionRemoveTarget): boolean {
  return target.id.trim().length > 0 && target.position.every(Number.isFinite);
}

function commandMatchesTarget(command: ModedEditCommand, target: ConstructionRemoveTarget): boolean {
  return command.operation === "construction_remove"
    && command.targetPosition[0] === target.position[0]
    && command.targetPosition[1] === target.position[1]
    && command.targetPosition[2] === target.position[2];
}

export function createConstructionRemoveAuthorizer(
  deps: ConstructionRemoveAuthorityDeps,
): ConstructionRemoveAuthorizer {
  return (target, existingCommand = null) => {
    try {
      if (!targetIsFinite(target)) return denied(deps, target, "not_ready");
      if (existingCommand && !commandMatchesTarget(existingCommand, target)) {
        return denied(deps, target, "target_moved");
      }

      const nowMs = (deps.nowMs ?? (() => performance.now()))();
      const terrainRevision = deps.getTerrainRevision();
      const maxDistanceM = deps.getMaxDistanceM();
      const mode = deps.getCurrentMode();
      const actorPosition = deps.getActorPosition();
      if (
        !actorPosition
        || !Number.isFinite(nowMs)
        || !Number.isSafeInteger(terrainRevision)
        || !Number.isFinite(maxDistanceM)
        || maxDistanceM < 0
        || !Number.isFinite(actorPosition.x)
        || !Number.isFinite(actorPosition.z)
        || mode.length === 0
      ) {
        return denied(deps, target, "not_ready");
      }

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
        maxDistanceM,
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
  const entry: InstalledAuthorizer = {
    token: Symbol("construction-remove-authorizer"),
    authorizer,
  };
  installedAuthorizers.push(entry);
  return () => {
    const index = installedAuthorizers.findIndex((candidate) => candidate.token === entry.token);
    if (index >= 0) installedAuthorizers.splice(index, 1);
  };
}

export function authorizeConstructionRemoval(
  target: ConstructionRemoveTarget,
  command?: ModedEditCommand | null,
): EditCommandVerdict {
  const authorizer = activeAuthorizer();
  if (!authorizer) return { allowed: false, reason: "not_ready" };
  return authorizer(target, command);
}
