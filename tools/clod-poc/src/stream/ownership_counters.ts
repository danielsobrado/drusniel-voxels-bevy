import type { TerrainOwnershipRuntimeSnapshot } from "./terrain_ownership_runtime.js";

export function publishOwnershipRuntimeCounters(
  counters: Record<string, number>,
  snapshot: TerrainOwnershipRuntimeSnapshot,
): void {
  counters["streamer_live_required_chunks"] = snapshot.live.required.length;
  counters["streamer_live_loaded_chunks"] = snapshot.live.loaded.length;
  counters["streamer_live_evictable_chunks"] = snapshot.live.evictable.length;
  counters["streamer_visual_required_pages"] = snapshot.visualPages.required.length;
  counters["streamer_visual_loaded_pages"] = snapshot.visualPages.loaded.length;
  counters["streamer_visual_evictable_pages"] = snapshot.visualPages.evictable.length;
  counters["streamer_live_radius_m"] = snapshot.ownership.liveRadiusM;
  counters["streamer_clod_radius_m"] = snapshot.ownership.clodRadiusM;
  counters["streamer_far_shell_inner_m"] = snapshot.farShell.innerRadiusM;
  counters["streamer_far_shell_outer_m"] = snapshot.farShell.outerRadiusM;
  counters["streamer_far_shell_ownership_ok"] = snapshot.farShell.innerRadiusM >= snapshot.ownership.clodRadiusM ? 1 : 0;
}
