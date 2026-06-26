// LOD0 page source — built by WELDING same-resolution chunk meshes, never re-extracted.

import { PageMesh, PageFootprint, ClodBuildError, triangleCount } from "../types.js";
import { ClodPagesConfig } from "../config.js";
import { meshChunk, WorldBounds } from "../terrain/terrain.js";
import { weldVertices, WeldReport } from "./weld.js";
import { filterPageSourceSections } from "./pageSource.js";
import type { PageSourceSection as PageSourceMeshSection } from "./pageSourceSections.js";

/** Sections that may appear in render meshes but must never enter the CLOD page source path. */
export type PageSourceSection =
  | "terrain_main"
  | "water"
  | "surf"
  | "deep_ocean"
  | "debug"
  | "props";

export const ALLOWED_PAGE_SOURCE_SECTIONS: ReadonlySet<PageSourceSection> = new Set(["terrain_main"]);

export const PAGE_SOURCE_SECTION: PageSourceSection = "terrain_main";

export interface PageSourcePurityReport {
  terrainTriangles: number;
  excludedTriangles: number;
  forbiddenSections: PageSourceSection[];
}

export function validatePageSourcePurity(
  meshes: readonly PageMesh[],
  sections: readonly PageSourceSection[],
): PageSourcePurityReport {
  let terrainTriangles = 0;
  let excludedTriangles = 0;
  const forbidden = new Set<PageSourceSection>();
  for (let i = 0; i < meshes.length; i++) {
    const section = sections[i] ?? PAGE_SOURCE_SECTION;
    const tris = triangleCount(meshes[i]);
    if (ALLOWED_PAGE_SOURCE_SECTIONS.has(section)) {
      terrainTriangles += tris;
    } else {
      excludedTriangles += tris;
      forbidden.add(section);
    }
  }
  return {
    terrainTriangles,
    excludedTriangles,
    forbiddenSections: [...forbidden],
  };
}

export function assertPageSourceTerrainOnly(report: PageSourcePurityReport): void {
  if (report.excludedTriangles > 0 || report.forbiddenSections.length > 0) {
    throw new ClodBuildError(
      "ForbiddenPageSourceSection",
      `page source contains ${report.excludedTriangles} triangles from forbidden sections: ${report.forbiddenSections.join(", ")}`,
    );
  }
}

export interface PageSource {
  mesh: PageMesh;
  footprint: PageFootprint;
  weld: WeldReport;
  /** Unwelded per-chunk meshes, row-major (dz*P + dx). Caller caches these for edits. */
  chunks: PageMesh[];
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
  const chunkSections: PageSourceSection[] = [];
  for (let dz = 0; dz < P; dz++) {
    for (let dx = 0; dx < P; dx++) {
      chunks.push(meshChunk(pageX * P + dx, pageZ * P + dz, cfg, world));
      chunkSections.push(PAGE_SOURCE_SECTION);
    }
  }
  if (chunks.length !== P * P) {
    throw new ClodBuildError("PageIncomplete", `expected ${P * P} chunks, got ${chunks.length}`);
  }

  const purity = validatePageSourcePurity(chunks, chunkSections);
  assertPageSourceTerrainOnly(purity);

  const sections: PageSourceMeshSection[] = chunks.map((mesh, index) => ({
    kind: "mainTerrain",
    terrainClass: "inland",
    positionSource: "extracted",
    label: `chunk-${index}`,
    mesh,
  }));
  const filtered = filterPageSourceSections(sections);
  const { mesh, report } = weldVertices(filtered.mesh, cfg.simplify.weld_epsilon_cells, {
    position: cfg.validation.position_epsilon,
    normalDot: cfg.validation.normal_dot_min,
    material: cfg.validation.material_weight_epsilon,
  });

  const footprint: PageFootprint = {
    minX: pageX * P * S,
    minZ: pageZ * P * S,
    maxX: (pageX + 1) * P * S,
    maxZ: (pageZ + 1) * P * S,
  };

  return { mesh, footprint, weld: report, chunks };
}

/** Cells a dig at `dirty` can perturb extend one cell past the box (gradient ±0.5 and the
 *  border quad's i±1 reads); use a 2-cell halo so a chunk is re-meshed whenever any vertex
 *  it owns — including its shared border — could move. Over-inclusion only costs a remesh;
 *  under-inclusion would leave a stale border, which the page weld then hard-fails on. */
const CHUNK_DIRTY_HALO_CELLS = 2;

export interface DirtyChunkBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Local chunk indices (dz*P + dx) of a page whose sampled cells `dirty` can reach. */
export function dirtyPageChunkIndices(
  pageX: number,
  pageZ: number,
  cfg: ClodPagesConfig,
  dirty: DirtyChunkBounds,
): number[] {
  const P = cfg.page.chunks_per_page;
  const S = cfg.page.chunk_size;
  const H = CHUNK_DIRTY_HALO_CELLS;
  const out: number[] = [];
  for (let dz = 0; dz < P; dz++) {
    for (let dx = 0; dx < P; dx++) {
      const cx = pageX * P + dx, cz = pageZ * P + dz;
      const x0 = cx * S - H, x1 = (cx + 1) * S + H;
      const z0 = cz * S - H, z1 = (cz + 1) * S + H;
      if (x0 <= dirty.maxX && x1 >= dirty.minX && z0 <= dirty.maxZ && z1 >= dirty.minZ) {
        out.push(dz * P + dx);
      }
    }
  }
  return expandChunkNeighborRing(out, P);
}

/** Re-mesh the 3x3 neighborhood around every dirty chunk so shared border/corner vertices
 *  are extracted from the same density field. Partial remesh of only the dirty chunk leaves
 *  stale neighbor normals that weld within epsilon but fail the normal-dot gate. */
export function expandChunkNeighborRing(indices: readonly number[], chunksPerPage: number): number[] {
  const P = chunksPerPage;
  const out = new Set(indices);
  for (const li of indices) {
    const dx = li % P, dz = (li / P) | 0;
    for (let ndz = dz - 1; ndz <= dz + 1; ndz++) {
      for (let ndx = dx - 1; ndx <= dx + 1; ndx++) {
        if (ndx >= 0 && ndx < P && ndz >= 0 && ndz < P) out.add(ndz * P + ndx);
      }
    }
  }
  return [...out];
}

/**
 * Re-mesh only the chunks of a cached page that `dirty` can perturb, mutating `chunkMeshes`
 * in place, then re-weld the whole page. The welded result is identical to a full
 * {@link buildLod0PageSource} because the unchanged chunks keep their exact vertices and the
 * weld is a pure function of the concatenated chunk meshes. Returns the assembled mesh and
 * how many chunks were re-extracted (for edit-cost telemetry).
 */
export function rebuildPageChunks(
  chunkMeshes: PageMesh[],
  pageX: number,
  pageZ: number,
  cfg: ClodPagesConfig,
  world: WorldBounds,
  dirty: DirtyChunkBounds,
): { mesh: PageMesh; remeshed: number } {
  const P = cfg.page.chunks_per_page;
  const indices = dirtyPageChunkIndices(pageX, pageZ, cfg, dirty);
  // Once a page is touched, re-extract every chunk. Partial remesh leaves neighbors
  // built under an older voxel revision and the page weld / parent merge hard-fails.
  const toRemesh = indices.length > 0
    ? Array.from({ length: P * P }, (_, li) => li)
    : indices;
  for (const li of toRemesh) {
    const dx = li % P, dz = (li / P) | 0;
    chunkMeshes[li] = meshChunk(pageX * P + dx, pageZ * P + dz, cfg, world);
  }
  const filtered = filterPageSourceSections(chunkMeshes.map((mesh, index) => ({
    kind: "mainTerrain",
    terrainClass: "inland",
    positionSource: "extracted",
    label: `chunk-${index}`,
    mesh,
  })));
  const { mesh } = weldVertices(filtered.mesh, cfg.simplify.weld_epsilon_cells, {
    position: cfg.validation.position_epsilon,
    normalDot: cfg.validation.normal_dot_min,
    material: cfg.validation.material_weight_epsilon,
  });
  return { mesh, remeshed: toRemesh.length };
}
