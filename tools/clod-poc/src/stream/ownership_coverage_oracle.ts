import type { FarClipmapOwnershipSnapshot } from "../terrain/far_clipmap/index.js";
import type { TerrainOwnershipRuntimeSnapshot } from "./terrain_ownership_runtime.js";
import { packLiveKey } from "./live_chunk_keys.js";
import { packPageKey, parsePageKey } from "./page_plan.js";
import type { OwnershipResidencyFeeds } from "./ownership_residency.js";
import {
  countMissingPacked,
  createSnapshotOwnershipResidencyFeeds,
  packedLiveKeySetWithinRadius,
  pageCoveredByResidentClodHierarchy,
} from "./ownership_residency.js";
import { farClipmapBandContainsCell, farClipmapCoversCell } from "./far_clipmap_ownership.js";

export interface OwnershipCoverageOracleInput {
  snapshot: TerrainOwnershipRuntimeSnapshot;
  chunkSizeM: number;
  pageSizeM: number;
  maxLevel: number;
  requiredRootLevel?: number;
  liveRequiredRadiusM?: number;
  camera: { x: number; z: number };
  farShellCenter: { x: number; z: number };
  farShellRecenterCount: number;
  farShellLastRecenterFrame: number;
  farClipmap?: FarClipmapOwnershipSnapshot;
  residencyFeeds?: OwnershipResidencyFeeds;
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
  priority_owner_overlap_cells: number;
  priority_unowned_cells: number;
  clod_parent_coverage_violations: number;
  far_clipmap_owned_cells: number;
  far_clipmap_unowned_cells: number;
  far_clipmap_ownership_holes: number;
  far_clipmap_priority_overlap_cells: number;
  owner_far_clipmap_cells: number;
  owner_clod_refinement_cells: number;
  owner_live_cells: number;
}

function liveOwns(loaded: ReadonlySet<number>, x: number, z: number, chunkSizeM: number): boolean {
  return loaded.has(packLiveKey(Math.floor(x / chunkSizeM), Math.floor(z / chunkSizeM)));
}

function clodOwns(loaded: ReadonlySet<number>, x: number, z: number, pageSizeM: number, maxLevel: number): boolean {
  for (let level = 0; level <= maxLevel; level++) {
    const size = pageSizeM * 2 ** level;
    if (loaded.has(packPageKey(level, Math.floor(x / size), Math.floor(z / size)))) return true;
  }
  return false;
}

function clodParentCoverageViolations(
  required: readonly string[],
  loadedPacked: ReadonlySet<number>,
  requiredRootLevel: number,
  maxCoverageLevel: number,
): number {
  let violations = 0;
  for (const key of required) {
    const page = parsePageKey(key);
    if (page.level !== requiredRootLevel) continue;
    if (!pageCoveredByResidentClodHierarchy(page, loadedPacked, maxCoverageLevel)) violations++;
  }
  return violations;
}

function clodStreamSafetyOverride(): number | null {
  const counters = (globalThis as typeof globalThis & {
    window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
  }).window?.__drusnielClod?.stats?.counters;
  if (!counters) return null;
  const required = counters["live_clod_stream_required_pages"] ?? 0;
  if (!Number.isFinite(required) || required <= 0) return null;
  const parentCoverage = counters["live_clod_stream_parent_coverage_violations"];
  if (!Number.isFinite(parentCoverage)) return null;
  return Math.max(0, Math.floor(parentCoverage));
}

function farCenterForInput(input: OwnershipCoverageOracleInput): { x: number; z: number } {
  if (!input.farClipmap?.enabled) return input.farShellCenter;
  return { x: input.farClipmap.centerX, z: input.farClipmap.centerZ };
}

function farInnerRadiusForInput(input: OwnershipCoverageOracleInput): number {
  return input.farClipmap?.enabled ? input.farClipmap.innerRadiusM : input.snapshot.farShell.innerRadiusM;
}

function farOuterRadiusForInput(input: OwnershipCoverageOracleInput): number {
  return input.farClipmap?.enabled
    ? input.farClipmap.outerRadiusM
    : Math.max(input.snapshot.farShell.outerRadiusM, input.snapshot.farShell.innerRadiusM);
}

export function computeOwnershipCoverageCounters(input: OwnershipCoverageOracleInput): OwnershipCoverageCounters {
  const { snapshot } = input;
  const chunkSizeM = Math.max(1, input.chunkSizeM);
  const pageSizeM = Math.max(chunkSizeM, input.pageSizeM);
  const coverageCellM = Math.max(chunkSizeM, input.coverageCellM ?? pageSizeM);
  const requiredLive = packedLiveKeySetWithinRadius(
    snapshot.live.required,
    snapshot.center,
    chunkSizeM,
    input.liveRequiredRadiusM,
  );
  const residencyFeeds = input.residencyFeeds ?? createSnapshotOwnershipResidencyFeeds(snapshot);
  const loadedLive = residencyFeeds.liveReady();
  const loadedClod = residencyFeeds.clodReady();
  const missingLive = countMissingPacked(requiredLive, loadedLive);
  const requiredRootLevel = Math.max(0, Math.min(input.maxLevel, Math.floor(input.requiredRootLevel ?? input.maxLevel)));
  const analyticParentCoverageViolations = clodParentCoverageViolations(snapshot.visualPages.required, loadedClod, requiredRootLevel, input.maxLevel);
  const parentCoverageViolations = clodStreamSafetyOverride() ?? analyticParentCoverageViolations;
  const missingClod = parentCoverageViolations;

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
  let farClipmapOwnedCells = 0;
  let farClipmapUnownedCells = 0;
  let farClipmapOwnershipHoles = 0;
  let farClipmapPriorityOverlapCells = 0;
  let ownerFarClipmapCells = 0;
  let ownerClodRefinementCells = 0;
  let ownerLiveCells = 0;

  const clodCenter = snapshot.center;
  const farCenter = farCenterForInput(input);
  const clodOuterRadius = Math.max(snapshot.ownership.liveRadiusM, snapshot.ownership.clodRadiusM);
  const farInnerRadius = farInnerRadiusForInput(input);
  const farOuterRadius = farOuterRadiusForInput(input);
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
      const analyticFar = farDistance >= snapshot.farShell.innerRadiusM && farDistance <= snapshot.farShell.outerRadiusM;
      const farClipmapBand = farClipmapBandContainsCell(input.farClipmap, x, z);
      const farClipmapOwned = farClipmapCoversCell(input.farClipmap, x, z);
      const far = farClipmapOwned || (!input.farClipmap?.enabled && analyticFar);

      if (live && clod) liveClodOverlap++;
      if (clod && far) clodFarOverlap++;
      if (farClipmapOwned) farClipmapOwnedCells++;
      if (farClipmapBand && !farClipmapOwned) farClipmapUnownedCells++;
      if (clodDistance <= snapshot.ownership.clodRadiusM && !live && !clod) liveClodGap++;
      if (clodDistance > snapshot.ownership.clodRadiusM && farDistance < farInnerRadius && !clod && !far) clodFarGap++;

      const liveOwner = live;
      const clodOwner = clod && !live;
      const farOwner = far && !clod && !live;
      const ownerCount = (liveOwner ? 1 : 0) + (clodOwner ? 1 : 0) + (farOwner ? 1 : 0);
      if (ownerCount > 1) priorityOwnerOverlap++;
      if (liveOwner && clodOwner) unresolvedLiveClodOverlap++;
      if (clodOwner && farOwner) unresolvedClodFarOverlap++;
      if (liveOwner) ownerLiveCells++;
      if (clodOwner) ownerClodRefinementCells++;
      if (farOwner && farClipmapOwned) ownerFarClipmapCells++;
      if (farClipmapOwned && (live || clod)) farClipmapPriorityOverlapCells++;

      const inCoverageEnvelope =
        clodDistance <= snapshot.ownership.clodRadiusM ||
        (farDistance >= farInnerRadius && farDistance <= farOuterRadius);
      if (inCoverageEnvelope && ownerCount === 0) priorityUnowned++;
      if (farClipmapBand && !live && !clod && !farClipmapOwned) farClipmapOwnershipHoles++;

      const nearClodOuterBoundary = Math.abs(clodDistance - snapshot.ownership.clodRadiusM) <= coverageCellM;
      const nearFarInnerBoundary = Math.abs(farDistance - farInnerRadius) <= coverageCellM;
      if (nearClodOuterBoundary || nearFarInnerBoundary) {
        horizonSamples++;
        if ((!clod && !far) || (clod && far)) rawHorizonHoles++;
        if (inCoverageEnvelope && ownerCount === 0) unresolvedHorizonHoles++;
      }
    }
  }

  const ringBoundaryHoles = liveClodGap + clodFarGap + missingLive + missingClod + farClipmapOwnershipHoles;
  return {
    camera_to_clod_center_m: Math.hypot(input.camera.x - clodCenter.x, input.camera.z - clodCenter.z),
    camera_to_far_shell_center_m: Math.hypot(input.camera.x - farCenter.x, input.camera.z - farCenter.z),
    far_shell_inner_minus_clod_radius_m: farInnerRadius - snapshot.ownership.clodRadiusM,
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
    clod_parent_coverage_violations: parentCoverageViolations,
    far_clipmap_owned_cells: farClipmapOwnedCells,
    far_clipmap_unowned_cells: farClipmapUnownedCells,
    far_clipmap_ownership_holes: farClipmapOwnershipHoles,
    far_clipmap_priority_overlap_cells: farClipmapPriorityOverlapCells,
    owner_far_clipmap_cells: ownerFarClipmapCells,
    owner_clod_refinement_cells: ownerClodRefinementCells,
    owner_live_cells: ownerLiveCells,
  };
}

export function publishOwnershipCoverageCounters(
  counters: Record<string, number>,
  values: Partial<OwnershipCoverageCounters>,
): void {
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "number") counters[key] = value;
  }
  if (typeof values.missing_live_chunks_in_required_radius === "number") {
    counters["residency_missing_live"] = values.missing_live_chunks_in_required_radius;
  }
  if (typeof values.missing_clod_pages_in_required_radius === "number") {
    counters["residency_missing_clod"] = values.missing_clod_pages_in_required_radius;
  }
}
