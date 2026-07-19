// Outer-border lock detection.
//
// Only the CURRENT parent's outer footprint border is locked; old child borders must
// already be welded and free. Surface Nets places vertices INSIDE cells, so the border
// is non-planar. We instead lock the mesh's open topological boundary, which after
// internal welding is exactly the page's outer border.

import { PageMesh } from "./types.js";
import { openBoundaryVertexFlags } from "./clod/validate.js";

export function buildOuterBorderLocks(mesh: PageMesh): Uint8Array {
  return openBoundaryVertexFlags(mesh);
}

/** Extra per-vertex lock predicate for parent simplification (world-space x, z). */
export type SimplifyCorridorLockQuery = (x: number, z: number) => boolean;

let corridorLockQuery: SimplifyCorridorLockQuery | null = null;

/**
 * Install the corridor lock predicate for parent simplification (per realm: the CLOD
 * worker and the main thread each install their own). Traced-hydrology worlds lock
 * river-corridor vertices so the carved channel survives every simplification level
 * exactly the way outer borders do; null clears the predicate (non-traced worlds).
 */
export function setSimplifyCorridorLockQuery(query: SimplifyCorridorLockQuery | null): void {
  corridorLockQuery = query;
}

/** Locks for parent simplification: the outer border plus any installed corridor. */
export function buildParentSimplifyLocks(mesh: PageMesh): Uint8Array {
  const locks = buildOuterBorderLocks(mesh);
  const query = corridorLockQuery;
  if (query) {
    const positions = mesh.positions;
    for (let i = 0; i < locks.length; i++) {
      if (locks[i] === 0 && query(positions[i * 3], positions[i * 3 + 2])) locks[i] = 1;
    }
  }
  return locks;
}

export function countLocks(locks: Uint8Array): number {
  let c = 0;
  for (let i = 0; i < locks.length; i++) c += locks[i];
  return c;
}
