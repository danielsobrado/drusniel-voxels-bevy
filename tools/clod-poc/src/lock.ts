// Outer-border lock detection.
//
// Only the CURRENT parent's outer footprint border is locked; old child borders must
// already be welded and free. Surface Nets places vertices INSIDE cells, so the border
// is non-planar. We instead lock the mesh's open topological boundary, which after
// internal welding is exactly the page's outer border.

import { PageMesh } from "./types.js";
import { openBoundaryVertexFlags } from "./validate.js";

export function buildOuterBorderLocks(mesh: PageMesh): Uint8Array {
  return openBoundaryVertexFlags(mesh);
}

export function countLocks(locks: Uint8Array): number {
  let c = 0;
  for (let i = 0; i < locks.length; i++) c += locks[i];
  return c;
}
