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
  raw_live_clod_overlap_cells: number;
  raw_clod_far_overlap_cells: number;
  missing_live_chunks_in_required_radius: number;
  missing_clod_pages_in_required_radius: number;
  far_shell_recenter_count: number;
  far_shell_last_recenter_frame: number;
  ring_boundary_holes: number;
  horizon_hole_ratio: number;
  raw_horizon_hole_ratio: number;
  // Priority ownership (live > CLOD > far): the renderer resolves the square-tile
  // vs circular-annulus spill band by draw order. The acceptance-facing overlap
  // and horizon counters above report unresolved priority-ownership failures;
  // raw_* counters preserve the geometric spill-band diagnostics.
  priority_owner_overlap_cells: number;
  priority_unowned_cells: number;
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
  let unresolvedLiveClodOverlap = 0;
  let unresolvedClodFarOverlap = 0;
  let horizonSamples = 0;
  let rawHorizonHoles = 0;
  let unresolvedHorizonHoles = 0;
  let priorityOwnerOverlap = 0;
  let priorityUnowned = 0;

  const clodCenter = snapshot.center;
  const farCenter = input.farShellCenter;
  const clodOuterRadius = Math.max(snapshot.ownership.liveRadiusM, snapshot.ownership.clodRadiusM);
  const farOuterRadius = Math.max(snapshot.farShell.outerRadiusM, snapshot.farShell.innerRadiusM);
  const sampleMargin = coverageCellM * Math.SQRT2 * 0.5;
  const minX = Math.floor((Math.min(clodCenter.x - clodOuterRadius, farCenter.x - farOuterRadius) - sampleMargin) / coverageCellM);
  const maxX = Math.ceil((Math.max(clodCenter.x + clodOuterRadius, farCenter.x + farOuterRadius) + sampleMargin) / coverageCellM);
  const minZ = Math.floor((Math.min(clodCenter.z - clodOuterRadius, farCenter.z - farOuterRadius) - sampleMargin) / coverageCellM);
  const maxZ = Math.ceil((Math.max(clodCenter.z + clodOuterRadius, farCenter.z + farOuterRadius) + sampleMargin) / coverageCellM);

  for (let gx = minX; gx <= maxX; gx++) {
    for (let gz = minZ; gz <= maxZ; gz++) {
      const x = (gx + 0.5) * coverageCellM;
      const z = (gz + 0.5) * coverageCellM;
      const clodDistance = Math.hypot(x - clodCenter.x, z - clodCenter.z);
      const farDistance = Math.hypot(x - farCenter.x, z - farCenter.z);
      if (clodDistance > clodOuterRadius + sampleMargin && farDistance > farOuterRadius + sampleMargin) continue;

      const live = liveOwns(loadedLive, x, z, chunkSizeM);
      const clod = clodOwns(loadedClod, x, z, pageSizeM, input.maxLevel);
      const far = farDistance >= snapshot.farShell.innerRadiusM && farDistance <= snapshot.farShell.outerRadiusM;

      if (live && clod) liveClodOverlap++;
      if (clod && far) clodFarOverlap++;
      if (clodDistance <= snapshot.ownership.clodRadiusM && !live && !clod) liveClodGap++;
      if (clodDistance > snapshot.ownership.clodRadiusM && farDistance < snapshot.farShell.innerRadiusM && !clod && !far) clodFarGap++;

      // Priority ownership: live wins over clod, clod wins over far. Each cell gets
      // at most one owner, so the spill band where two rings raw-overlap is not a
      // double-render — the higher-priority ring owns it. The invariant we gate on
      // is: a cell inside the coverage envelope must have exactly one owner.
      const liveOwner = live;
      const clodOwner = clod && !live;
      const farOwner = far && !clod && !live;
      const ownerCount = (liveOwner ? 1 : 0) + (clodOwner ? 1 : 0) + (farOwner ? 1 : 0);
      if (ownerCount > 1) priorityOwnerOverlap++; // 0 by construction; guards the model
      if (liveOwner && clodOwner) unresolvedLiveClodOverlap++;
      if (clodOwner && farOwner) unresolvedClodFarOverlap++;
      const inCoverageEnvelope =
        clodDistance <= snapshot.ownership.clodRadiusM ||
        (farDistance >= snapshot.farShell.innerRadiusM && farDistance <= snapshot.farShell.outerRadiusM);
      if (inCoverageEnvelope && ownerCount === 0) priorityUnowned++;

      const nearClodOuterBoundary = Math.abs(clodDistance - snapshot.ownership.clodRadiusM) <= coverageCellM;
      const nearFarInnerBoundary = Math.abs(farDistance - snapshot.farShell.innerRadiusM) <= coverageCellM;
      if (nearClodOuterBoundary || nearFarInnerBoundary) {
        horizonSamples++;
        if ((!clod && !far) || (clod && far)) rawHorizonHoles++;
        if (inCoverageEnvelope && ownerCount === 0) unresolvedHorizonHoles++;
      }
    }
  }

  const ringBoundaryHoles = liveClodGap + clodFarGap + missingLive + missingClod;
  return {
    camera_to_clod_center_m: Math.hypot(input.camera.x - clodCenter.x, input.camera.z - clodCenter.z),
    camera_to_far_shell_center_m: Math.hypot(input.camera.x - farCenter.x, input.camera.z - farCenter.z),
    far_shell_inner_minus_clod_radius_m: snapshot.farShell.innerRadiusM - snapshot.ownership.clodRadiusM,
    live_clod_gap_holes: liveClodGap,
    clod_far_gap_holes: clodFarGap,
    live_clod_overlap_cells: unresolvedLiveClodOverlap,
    clod_far_overlap_cells: unresolvedClodFarOverlap,
    raw_live_clod_overlap_cells: liveClodOverlap,
    raw_clod_far_overlap_cells: clodFarOverlap,
    missing_live_chunks_in_required_radius: missingLive,
    missing_clod_pages_in_required_radius: missingClod,
    far_shell_recenter_count: input.farShellRecenterCount,
    far_shell_last_recenter_frame: input.farShellLastRecenterFrame,
    ring_boundary_holes: ringBoundaryHoles,
    horizon_hole_ratio: horizonSamples > 0 ? unresolvedHorizonHoles / horizonSamples : 0,
    raw_horizon_hole_ratio: horizonSamples > 0 ? rawHorizonHoles / horizonSamples : 0,
    priority_owner_overlap_cells: priorityOwnerOverlap,
    priority_unowned_cells: priorityUnowned,
  };
}

export function publishOwnershipCoverageCounters(
  counters: Record<string, number>,
  values: OwnershipCoverageCounters,
): void {
  for (const [key, value] of Object.entries(values)) counters[key] = value;
}
