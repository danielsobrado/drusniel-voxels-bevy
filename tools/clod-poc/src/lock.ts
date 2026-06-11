// Outer-border lock detection. Plan §3.2 / §11.4.
//
// Only the CURRENT parent's outer footprint border is locked; old child borders must
// already be welded and free. The plan's appendix suggests detecting the border by
// quantized footprint-plane position, but Surface Nets places vertices INSIDE cells, so
// the border is non-planar — a PoC finding. We instead lock the mesh's open (topological)
// boundary, which after internal welding IS exactly the page's outer border (plan §3.1).

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
