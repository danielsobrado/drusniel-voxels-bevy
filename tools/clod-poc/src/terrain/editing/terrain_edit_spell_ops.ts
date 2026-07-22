import * as THREE from "three";
import type { ClodWorkerClient } from "../../clod_worker_client.js";
import {
  applyDigEditTransaction,
  getDigEditRevision,
  hasPaintedTerrainEdits,
  rollbackDigEditTransaction,
  voxelTransactionFromDigEdit,
  type DigEdit,
  type VoxelEditTransaction,
} from "../../terrain/terrain.js";
import { gameplayDiagnostics } from "../../player/gameplay_diagnostics.js";
import {
  validateEditCommand,
  type EditCommandDenialReason,
} from "../../player/edit_commands.js";
import type { PlayerEditAuthorityConfig } from "../../player/player_edit_authority.js";
import type {
  TerrainSpellEditRequest,
  TerrainSpellEditResult,
} from "./terrain_edit_service.js";
import type { TerrainEditCommitStatus } from "./terrain_edit_dig_ops.js";

export interface TerrainEditSpellOpsDeps {
  editAuthority?: PlayerEditAuthorityConfig;
  getInteractionMode?: () => string;
  editReadyAt?: (x: number, z: number) => boolean;
  protectedAt?: (x: number, z: number) => boolean;
  clodWorker: Pick<ClodWorkerClient, "flushParents">;
  authorityOrigin: () => THREE.Vector3 | null;
  addCounter: (key: string, amount?: number) => void;
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
  runDerivedUpdate: (label: string, update: () => void) => void;
  flushVegetationRebuilds: () => void;
  getAuthorityCounters: () => Record<string, number> | null;
}

export interface TerrainEditSpellOps {
  commitSpellTerrainEdit(
    request: TerrainSpellEditRequest,
    onAuthoritativeCommit?: () => void,
  ): Promise<TerrainSpellEditResult>;
}

export function createTerrainEditSpellOps(deps: TerrainEditSpellOpsDeps): TerrainEditSpellOps {
  const recordSpellDenial = (reason: EditCommandDenialReason): void => {
    deps.addCounter("spell_world_casts_denied");
    deps.addCounter(`spell_world_casts_denied_${reason}`);
    if (reason === "expired") gameplayDiagnostics.add("edit_commands_expired");
    else if (reason === "revision_mismatch") gameplayDiagnostics.add("edit_commands_denied_revision");
    else if (reason === "out_of_range") gameplayDiagnostics.add("edit_commands_denied_distance");
    else if (reason === "mode_changed") gameplayDiagnostics.add("edit_commands_denied_mode");
    else if (reason === "target_moved") gameplayDiagnostics.add("edit_commands_denied_target_moved");
    else gameplayDiagnostics.add("edits_denied_not_ready");
    deps.setLastDigSummary(`spell terrain edit rejected: ${reason}`);
    deps.updateInfo();
  };

  const commitSpellTerrainEdit = async (
    request: TerrainSpellEditRequest,
    onAuthoritativeCommit?: () => void,
  ): Promise<TerrainSpellEditResult> => deps.enqueueEditOperation(`spell:${request.spellId}`, async () => {
    const point = new THREE.Vector3(...request.command.targetPosition);
    const actor = deps.authorityOrigin();
    if (!actor) {
      recordSpellDenial("not_ready");
      return { committed: false, changed: false, converged: false, reason: "not_ready", editRevision: getDigEditRevision() };
    }
    if (!deps.getInteractionMode) {
      recordSpellDenial("mode_changed");
      return { committed: false, changed: false, converged: false, reason: "mode_changed", editRevision: getDigEditRevision() };
    }
    if (!deps.editReadyAt) {
      recordSpellDenial("not_ready");
      return { committed: false, changed: false, converged: false, reason: "not_ready", editRevision: getDigEditRevision() };
    }
    const maxDistanceM = deps.editAuthority?.terrainEditRadiusM;
    if (maxDistanceM === undefined) {
      recordSpellDenial("out_of_range");
      return { committed: false, changed: false, converged: false, reason: "out_of_range", editRevision: getDigEditRevision() };
    }
    const verdict = validateEditCommand(request.command, {
      nowMs: performance.now(),
      currentTerrainRevision: getDigEditRevision(),
      actorPosition: actor,
      maxDistanceM,
      currentMode: deps.getInteractionMode(),
      targetReady: deps.editReadyAt(point.x, point.z),
    });
    if (!verdict.allowed) {
      recordSpellDenial(verdict.reason);
      return { committed: false, changed: false, converged: false, reason: verdict.reason, editRevision: getDigEditRevision() };
    }
    if (deps.protectedAt?.(point.x, point.z) || !deps.terrainCommitAllowed(point)) {
      recordSpellDenial("not_ready");
      return { committed: false, changed: false, converged: false, reason: "not_ready", editRevision: getDigEditRevision() };
    }

    const edit: DigEdit = { ...request.edit, x: point.x, y: point.y, z: point.z };
    const transaction = voxelTransactionFromDigEdit(edit);
    if (transaction.deltas.length === 0) {
      deps.setLastDigSummary(`${request.spellId} spell: no terrain changed`);
      deps.updateInfo();
      return {
        committed: false,
        changed: false,
        converged: false,
        reason: "no_change",
        editRevision: getDigEditRevision(),
      };
    }

    const hadPaintedTerrain = hasPaintedTerrainEdits();
    applyDigEditTransaction(transaction, edit);
    const committedRevision = getDigEditRevision();
    const status = await deps.performEditRebuild(edit, transaction, { point }, edit.r, `spell:${request.spellId}`);
    if (status === "rejected") {
      rollbackDigEditTransaction(transaction);
      deps.syncPaintedTerrainState(hadPaintedTerrain);
      deps.addCounter("spell_world_convergence_failed");
      return { committed: false, changed: false, converged: false, reason: "terrain_rebuild_rejected", editRevision: getDigEditRevision() };
    }

    // Count acceptance and fire VFX only after a non-rejected rebuild.
    deps.addCounter("spell_world_casts_accepted");
    deps.runDerivedUpdate("spell VFX commit callback", () => onAuthoritativeCommit?.());
    deps.addCounter("spell_world_edits_committed");
    deps.syncPaintedTerrainState(hadPaintedTerrain);

    if (status === "committed_render_stale") {
      deps.addCounter("spell_world_convergence_failed");
      deps.setLastDigSummary(`${request.spellId} spell terrain committed with stale render at revision ${committedRevision}`);
      deps.updateInfo();
      return {
        committed: true,
        changed: true,
        converged: false,
        reason: "committed_render_stale",
        editRevision: committedRevision,
      };
    }

    try {
      await deps.clodWorker.flushParents();
      deps.flushVegetationRebuilds();
    } catch (error) {
      deps.addCounter("spell_world_convergence_failed");
      const reason = error instanceof Error ? error.message : String(error);
      return { committed: true, changed: true, converged: false, reason, editRevision: committedRevision };
    }
    const counters = deps.getAuthorityCounters();
    if (counters) counters["spell_world_last_converged_revision"] = committedRevision;
    deps.addCounter("spell_world_convergence_completed");
    deps.setLastDigSummary(`${request.spellId} spell terrain converged at revision ${committedRevision}`);
    deps.updateInfo();
    return { committed: true, changed: true, converged: true, reason: null, editRevision: committedRevision };
  });

  return { commitSpellTerrainEdit };
}
