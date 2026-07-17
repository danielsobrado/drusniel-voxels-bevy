// Capability + revision readiness (playable-world-contract P1).
//
// "Ready" is meaningless without *for which action, against which terrain revision*: a
// collider from revision 40 under revision-43 terrain may be safe to stand on as an
// explicit stale collider — it is not edit-ready. The contract is data + pure functions
// over injected residency/revision feeds; capability fields land with their first
// consumer (movement + terrain edits here; construction/water join in their phases).
import type { TerrainColliderStatus, TerrainColliderSet } from "../terrain/terrain_collider.js";
import type { MovementReadiness } from "../player_controller.js";
import { voxelOverlayPointIsResident } from "../terrain/voxel_overlay/voxel_overlay.js";
import { voxelEditStore } from "../terrain/voxel_edits/voxel_edit_store.js";
import { getDigEditRevision } from "../terrain/terrain_edits.js";

const DEFAULT_TELEPORT_ENVELOPE_RADIUS_M = 0.6;

export type CellFallbackKind = "none" | "frontier_barrier" | "heightfield_certified";

export interface CellReadiness {
  /** Exact or explicitly stale-safe collider (or a certified heightfield column) serves here. */
  movementCollisionReady: boolean;
  /** Voxel authority resident and the cell's collider is at the latest revision — edits accepted. */
  terrainEditReady: boolean;
  terrainRevision: number;
  /** Highest revision among covering collider pages; -1 when no page covers the cell. */
  colliderRevision: number;
  /** A stale collider is explicitly allowed underfoot while its rebuild is prioritized. */
  staleColliderSafe: boolean;
  fallbackKind: CellFallbackKind;
}

export interface CellReadinessFeeds {
  terrainRevision(): number;
  colliderStatusAt(x: number, z: number): TerrainColliderStatus;
  /** Column proven single-surface: no voxel overlay, no edits, no overhang topology. */
  columnCertified(x: number, z: number): boolean;
  /** Voxel edit authority resident for this cell (edits would be accepted). */
  editAuthorityResidentAt(x: number, z: number): boolean;
}

/**
 * Staleness derives from the rebuild pipeline (a replacement is pending for a covering
 * page), not from comparing page revision against the global terrain revision — a global
 * compare would mark every untouched page stale after any edit anywhere. The revision
 * numbers are still reported for observability and bounds-aware consumers.
 */
export function cellReadinessAt(feeds: CellReadinessFeeds, x: number, z: number): CellReadiness {
  const terrainRevision = feeds.terrainRevision();
  const collider = feeds.colliderStatusAt(x, z);
  const stale = collider.covered && collider.replacementPending;

  let movementCollisionReady: boolean;
  let fallbackKind: CellFallbackKind;
  if (collider.covered) {
    movementCollisionReady = true;
    fallbackKind = "none";
  } else if (feeds.columnCertified(x, z)) {
    movementCollisionReady = true;
    fallbackKind = "heightfield_certified";
  } else {
    movementCollisionReady = false;
    fallbackKind = "frontier_barrier";
  }

  return {
    movementCollisionReady,
    terrainEditReady: collider.covered && !stale && feeds.editAuthorityResidentAt(x, z),
    terrainRevision,
    colliderRevision: collider.revision,
    staleColliderSafe: stale,
    fallbackKind,
  };
}

/** Probe shape consumed by the player controller's frontier barrier. */
export function movementReadinessAt(feeds: CellReadinessFeeds, x: number, z: number): MovementReadiness {
  const readiness = cellReadinessAt(feeds, x, z);
  if (!readiness.movementCollisionReady) return "blocked";
  return readiness.fallbackKind === "heightfield_certified" ? "certified" : "ready";
}

/** Spawn/teleport gate: authoritative target plus a collision-ready capsule footprint. */
export function teleportTargetReady(
  feeds: CellReadinessFeeds,
  x: number,
  z: number,
  envelopeRadiusM = DEFAULT_TELEPORT_ENVELOPE_RADIUS_M,
): boolean {
  if (!feeds.editAuthorityResidentAt(x, z)) return false;
  const radius = Math.max(0, envelopeRadiusM);
  const probes: readonly (readonly [number, number])[] = [
    [x, z],
    [x - radius, z],
    [x + radius, z],
    [x, z - radius],
    [x, z + radius],
  ];
  return probes.every(([probeX, probeZ]) => cellReadinessAt(feeds, probeX, probeZ).movementCollisionReady);
}

/**
 * Practical dig/build acceptance: a collider page is present (there is a surface to
 * target) and the voxel authority is resident. Collider staleness alone does NOT deny
 * edits — transactions are computed against the current voxel authority, so a hit point
 * on a one-tick-stale collider yields a no-op or a valid carve, never corruption. The
 * strict revision-aware answer lives in `CellReadiness.terrainEditReady`.
 */
export function editTargetAcceptable(feeds: CellReadinessFeeds, x: number, z: number): boolean {
  return feeds.colliderStatusAt(x, z).covered && feeds.editAuthorityResidentAt(x, z);
}

/**
 * App column certification, derived from the voxel authority's own masks and failing
 * closed: any resident voxel-overlay region (caves) or any voxel edit in the column
 * makes it 3D — uncertified. The base heightfield itself has no overhang topology.
 */
export function appColumnCertified(x: number, z: number): boolean {
  if (voxelOverlayPointIsResident(x, z)) return false;
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  return voxelEditStore.editedYRange(cx, cx + 1, cz, cz + 1) === null;
}

export function createAppCellReadinessFeeds(deps: { terrainColliders: TerrainColliderSet }): CellReadinessFeeds {
  return {
    terrainRevision: () => getDigEditRevision(),
    colliderStatusAt: (x, z) => deps.terrainColliders.colliderStatusAt(x, z),
    columnCertified: appColumnCertified,
    // The clod-poc voxel edit authority is process-resident everywhere; streamed
    // authorities replace this feed when they land.
    editAuthorityResidentAt: () => true,
  };
}
