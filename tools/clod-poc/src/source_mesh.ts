// LOD0 page source — built by WELDING same-resolution chunk meshes, never re-extracted.
// Plan §3.1 / §11.2 / invariant I2.

import { PageMesh, PageFootprint, ClodBuildError } from "./types.js";
import { ClodPagesConfig } from "./config.js";
import { meshChunk, WorldBounds } from "./terrain.js";
import { weldVertices, WeldReport } from "./weld.js";

export interface PageSource {
  mesh: PageMesh;
  footprint: PageFootprint;
  weld: WeldReport;
}

/** Concatenate several PageMeshes into one buffer (no welding yet). */
export function concat(meshes: PageMesh[]): PageMesh {
  let nv = 0, ni = 0;
  for (const m of meshes) {
    nv += m.positions.length / 3;
    ni += m.indices.length;
  }
  const positions = new Float32Array(nv * 3);
  const normals = new Float32Array(nv * 3);
  const materials = new Float32Array(nv * 4);
  const indices = new Uint32Array(ni);
  let vOff = 0, iOff = 0;
  for (const m of meshes) {
    positions.set(m.positions, vOff * 3);
    normals.set(m.normals, vOff * 3);
    materials.set(m.materials, vOff * 4);
    for (let i = 0; i < m.indices.length; i++) indices[iOff + i] = m.indices[i] + vOff;
    vOff += m.positions.length / 3;
    iOff += m.indices.length;
  }
  return { positions, normals, materials, indices };
}

/**
 * Build a LOD0 page source from its PxP chunks (page coords pageX,pageZ).
 * Step order mirrors §11.2: require PxP chunks -> concat (origins already applied in
 * world space by meshChunk) -> weld internal chunk borders -> outer border preserved.
 */
export function buildLod0PageSource(
  pageX: number,
  pageZ: number,
  cfg: ClodPagesConfig,
  world: WorldBounds,
): PageSource {
  const P = cfg.page.chunks_per_page;
  const S = cfg.page.chunk_size;

  const chunks: PageMesh[] = [];
  for (let dz = 0; dz < P; dz++) {
    for (let dx = 0; dx < P; dx++) {
      chunks.push(meshChunk(pageX * P + dx, pageZ * P + dz, cfg, world));
    }
  }
  if (chunks.length !== P * P) {
    throw new ClodBuildError("PageIncomplete", `expected ${P * P} chunks, got ${chunks.length}`);
  }

  const merged = concat(chunks);
  const { mesh, report } = weldVertices(merged, cfg.simplify.weld_epsilon_cells);

  const footprint: PageFootprint = {
    minX: pageX * P * S,
    minZ: pageZ * P * S,
    maxX: (pageX + 1) * P * S,
    maxZ: (pageZ + 1) * P * S,
  };

  return { mesh, footprint, weld: report };
}
