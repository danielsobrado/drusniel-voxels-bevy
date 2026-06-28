import type { TerrainOwnershipRuntimeSnapshot } from "./terrain_ownership_runtime.js";
import { liveChunkKey } from "./live_chunk_keys.js";
import { pageKey } from "./page_plan.js";

export interface OwnershipCoverageOracleInput {
  snapshot: TerrainOwnershipRuntimeSnapshot;
  chunkSizeM: number;
  pageSizeM: number;
  maxLevel: number;
  camera: { x: number; z: number };
  farShellCenter: { x: number; z: number };
  farShellRecenterCount: number;
  farShellLastRecenterFrame: number;
  coverageCellM?: number;
}

export interface OwnershipCoverageCounters {
  camera_to_clod_center_m: number;
  camera_to_far_shell_center_m: number;
  far_shell_inner_minus_clod_radius_m: number;
  live_clod_gap_holes: number;
  clod_far_gap_holes: number;
  live_clod_overlap_cells: number;
  clod_far_overlap_cells: number;
  missing_live_chunks_in_required_radius: number;
  missing_clod_pages_in_required_radius: number;
  far_shell_recenter_count: number;
  far_shell_last_recenter_frame: number;
  ring_boundary_holes: number;
  horizon_hole_ratio: number;
}

function setDifferenceCount(required: readonly string[], loaded: ReadonlySet<string>): number {
  let missing = 0;
  for (const key of required) if (!loaded.has(key)) missing++;
  return missing;
}

function liveOwns(loaded: ReadonlySet<string>, x: number, z: number, chunkSizeM: number): boolean {
  return loaded.has(liveChunkKey({
    x: Math.floor(x / chunkSizeM),
    z: Math.floor(z / chunkSizeM),
  }));
}

function clodOwns(loaded: ReadonlySet<string>, x: number, z: number, pageSizeM: number, maxLevel: number): boolean {
  for (let level = 0; level <= maxLevel; level++) {
    const size = pageSizeM * 2 ** level;
    if (loaded.has(pageKey(level, Math.floor(x / size), Math.floor(z / size)))) return true;
  }
  return false;
}

export function computeOwnershipCoverageCounters(input: OwnershipCoverageOracleInput): OwnershipCoverageCounters {
  const { snapshot } = input;
  const chunkSizeM = Math.max(1, input.chunkSizeM);
  const pageSizeM = Math.max(chunkSizeM, input.pageSizeM);
  const coverageCellM = Math.max(chunkSizeM, input.coverageCellM ?? pageSizeM);
  const loadedLive = new Set(snapshot.live.loaded);
  const loadedClod = new Set(snapshot.visualPages.loaded);
  const missingLive = setDifferenceCount(snapshot.live.required, loadedLive);
  const missingClod = setDifferenceCount(snapshot.visualPages.required, loadedClod);

  let liveClodGap = 0;
  let clodFarGap = 0;
  let liveClodOverlap = 0;
  let clodFarOverlap = 0;
  let horizonSamples = 0;
  let horizonHoles = 0;

  const outerRadius = Math.max(snapshot.farShell.outerRadiusM, snapshot.farShell.innerRadiusM, snapshot.ownership.clodRadiusM);
  const minX = Math.floor((snapshot.center.x - outerRadius) / coverageCellM);
  const maxX = Math.ceil((snapshot.center.x + outerRadius) / coverageCellM);
  const minZ = Math.floor((snapshot.center.z - outerRadius) / coverageCellM);
  const maxZ = Math.ceil((snapshot.center.z + outerRadius) / coverageCellM);

  for (let gx = minX; gx <= maxX; gx++) {
    for (let gz = minZ; gz <= maxZ; gz++) {
      const x = (gx + 0.5) * coverageCellM;
      const z = (gz + 0.5) * coverageCellM;
      const d = Math.hypot(x - snapshot.center.x, z - snapshot.center.z);
      if (d > outerRadius + coverageCellM * Math.SQRT2 * 0.5) continue;

      const live = liveOwns(loadedLive, x, z, chunkSizeM);
      const clod = clodOwns(loadedClod, x, z, pageSizeM, input.maxLevel);
      const far = d >= snapshot.farShell.innerRadiusM && d <= snapshot.farShell.outerRadiusM;

      if (live && clod) liveClodOverlap++;
      if (clod && far) clodFarOverlap++;
      if (d <= snapshot.ownership.clodRadiusM && !live && !clod) liveClodGap++;
      if (d > snapshot.ownership.clodRadiusM && d < snapshot.farShell.innerRadiusM && !clod && !far) clodFarGap++;

      if (d >= snapshot.ownership.clodRadiusM - coverageCellM && d <= snapshot.farShell.innerRadiusM + coverageCellM) {
        horizonSamples++;
        if ((!clod && !far) || (clod && far)) horizonHoles++;
      }
    }
  }

  const ringBoundaryHoles = liveClodGap + clodFarGap + missingLive + missingClod;
  return {
    camera_to_clod_center_m: Math.hypot(input.camera.x - snapshot.center.x, input.camera.z - snapshot.center.z),
    camera_to_far_shell_center_m: Math.hypot(input.camera.x - input.farShellCenter.x, input.camera.z - input.farShellCenter.z),
    far_shell_inner_minus_clod_radius_m: snapshot.farShell.innerRadiusM - snapshot.ownership.clodRadiusM,
    live_clod_gap_holes: liveClodGap,
    clod_far_gap_holes: clodFarGap,
    live_clod_overlap_cells: liveClodOverlap,
    clod_far_overlap_cells: clodFarOverlap,
    missing_live_chunks_in_required_radius: missingLive,
    missing_clod_pages_in_required_radius: missingClod,
    far_shell_recenter_count: input.farShellRecenterCount,
    far_shell_last_recenter_frame: input.farShellLastRecenterFrame,
    ring_boundary_holes: ringBoundaryHoles,
    horizon_hole_ratio: horizonSamples > 0 ? horizonHoles / horizonSamples : 0,
  };
}

export function publishOwnershipCoverageCounters(
  counters: Record<string, number>,
  values: OwnershipCoverageCounters,
): void {
  for (const [key, value] of Object.entries(values)) counters[key] = value;
}
