// Reason-coded gameplay counters (playable-world-contract P0.3).
//
// The height fallback, recovery teleport, and collider streaming all fire for a mix of
// benign and pathological reasons; raw event counts gate nothing meaningful. Every
// fallback / recovery / barrier / rebuild event records *why*, so acceptance gates can
// target only real failures (`collider_coverage_missing`, unexplained recoveries) while
// benign classes (`collider_exact_no_ground` while jumping) stay visible but ungated.

/** Reason/event keys with a defined meaning. Gauges (ms, timestamps) share the map. */
export type GameplayCounterKey =
  // Capsule resolution reasons (one per fixed step where the condition held).
  | "collider_exact_no_ground" // benign: airborne over covered cells
  | "collider_coverage_missing" // no collider page covers the capsule column — streaming failure, THIS gates
  | "collider_stale_frames" // resolved against a collider with a pending replacement (stale-safe policy active)
  | "fallback_heightfield_certified" // height fallback fired in a certified single-surface column
  | "fallback_denied_uncertified" // fallback would have fired but the column is not certified (cave/edited)
  | "frontier_barrier_engagements" // movement stopped at a readiness frontier
  // Recovery reasons (P3 proven-invalid contract).
  | "player_recovery_non_finite" // NaN/Infinity in position or velocity
  | "player_recovery_kill_plane" // below the valid editable volume — true last resort
  | "player_recovery_missing_collider" // bounded steps falling in a blocked column
  | "player_recovery_backstop_depth" // crude 32 m sink rule (probe-less worlds / blocked-column backstop)
  // Edit command outcomes.
  | "edits_denied_not_ready"
  | "edit_commands_expired"
  | "edit_commands_denied_revision"
  | "edit_commands_denied_distance"
  | "edit_commands_denied_mode"
  | "edit_commands_denied_target_moved"
  // Collider build pipeline.
  | "collider_build_count"
  | "collider_build_total_ms"
  | "collider_sync_frame_builds" // MeshBVH built outside the rebuild pipeline (potential frame stall)
  | "collider_sync_frame_build_ms"
  | "collider_worker_build_count"
  | "collider_worker_build_total_ms"
  | "collider_worker_failures"
  | "collider_worker_fallback_builds"
  | "collider_jobs_queued"
  | "collider_jobs_inflight"
  | "collider_jobs_completed"
  | "collider_jobs_cancelled_stale"
  | "collider_jobs_requeued_origin_shift"
  | "collider_apply_ms"
  | "collider_queue_latency_ms" // latest job: enqueue → install
  | "collider_queue_latency_max_ms"
  // Readiness.
  | "time_to_gameplay_ready_ms";

export class GameplayDiagnostics {
  private readonly values = new Map<GameplayCounterKey, number>();

  add(key: GameplayCounterKey, amount = 1): void {
    this.values.set(key, (this.values.get(key) ?? 0) + amount);
  }

  /** Gauge write (latencies, timestamps): overwrites instead of accumulating. */
  set(key: GameplayCounterKey, value: number): void {
    this.values.set(key, value);
  }

  /** Gauge write that keeps the maximum seen since the last reset. */
  setMax(key: GameplayCounterKey, value: number): void {
    this.values.set(key, Math.max(this.values.get(key) ?? Number.NEGATIVE_INFINITY, value));
  }

  get(key: GameplayCounterKey): number {
    return this.values.get(key) ?? 0;
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.values);
  }

  publish(counters: Record<string, number>): void {
    for (const [key, value] of this.values) counters[key] = value;
  }

  reset(): void {
    this.values.clear();
  }
}

/** Shared app instance; the frame loop publishes it into `stats.counters` every frame. */
export const gameplayDiagnostics = new GameplayDiagnostics();

export function publishGameplayDiagnostics(counters: Record<string, number>): void {
  gameplayDiagnostics.publish(counters);
}

export function resetGameplayDiagnosticsForTests(): void {
  gameplayDiagnostics.reset();
}
