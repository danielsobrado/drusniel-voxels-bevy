// LOD0 page source — built by WELDING same-resolution chunk meshes, never re-extracted.

import { PageMesh, PageFootprint, ClodBuildError, triangleCount } from "../types.js";
import { ClodPagesConfig } from "../config.js";
import { meshChunk, WorldBounds } from "../terrain/terrain.js";
import { weldVertices, WeldReport } from "./weld.js";
import { filterPageSourceSections } from "./pageSource.js";
import type { PageSourceSection as PageSourceMeshSection } from "./pageSourceSections.js";
import { validatePageMesh } from "./validate.js";

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

  const { mesh, report } = weldChunkMeshes(chunks, cfg);

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
 * Re-mesh only the chunks of a cached page that `dirty` can perturb, then re-weld the whole
 * page. The cached chunks are mutated only after a candidate page validates successfully;
 * failed validation leaves the previous cache intact so future edits cannot inherit a
 * half-applied chunk set.
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
  const toRemesh = dirtyPageChunkIndices(pageX, pageZ, cfg, dirty);
  const footprint = pageFootprint(pageX, pageZ, cfg);

  if (toRemesh.length === 0) {
    const { mesh } = weldChunkMeshes(chunkMeshes, cfg);
    validatePageMesh(mesh, footprint, cfg.validation.zero_area_epsilon, `L0:${pageX},${pageZ} unchanged-page weld`);
    return { mesh, remeshed: 0 };
  }

  try {
    const partialChunks = chunkMeshes.slice();
    for (const li of toRemesh) remeshChunk(partialChunks, li, pageX, pageZ, cfg, world);
    const { mesh } = weldChunkMeshes(partialChunks, cfg);
    validatePageMesh(mesh, footprint, cfg.validation.zero_area_epsilon, `L0:${pageX},${pageZ} partial edit-rebuild`);
    commitChunks(chunkMeshes, partialChunks, toRemesh);
    return { mesh, remeshed: toRemesh.length };
  } catch {
    const fullChunks = chunkMeshes.slice();
    const allChunks: number[] = [];
    for (let li = 0; li < P * P; li++) {
      remeshChunk(fullChunks, li, pageX, pageZ, cfg, world);
      allChunks.push(li);
    }
    const { mesh } = weldChunkMeshes(fullChunks, cfg);
    validatePageMesh(mesh, footprint, cfg.validation.zero_area_epsilon, `L0:${pageX},${pageZ} full edit-rebuild fallback`);
    commitChunks(chunkMeshes, fullChunks, allChunks);
    return { mesh, remeshed: P * P };
  }
}

function remeshChunk(
  chunkMeshes: PageMesh[],
  localIndex: number,
  pageX: number,
  pageZ: number,
  cfg: ClodPagesConfig,
  world: WorldBounds,
): void {
  const P = cfg.page.chunks_per_page;
  const dx = localIndex % P;
  const dz = (localIndex / P) | 0;
  chunkMeshes[localIndex] = meshChunk(pageX * P + dx, pageZ * P + dz, cfg, world);
}

function commitChunks(target: PageMesh[], source: readonly PageMesh[], indices: readonly number[]): void {
  for (const index of indices) target[index] = source[index];
}

function pageFootprint(pageX: number, pageZ: number, cfg: ClodPagesConfig): PageFootprint {
  const P = cfg.page.chunks_per_page;
  const S = cfg.page.chunk_size;
  return {
    minX: pageX * P * S,
    minZ: pageZ * P * S,
    maxX: (pageX + 1) * P * S,
    maxZ: (pageZ + 1) * P * S,
  };
}

function weldChunkMeshes(chunks: readonly PageMesh[], cfg: ClodPagesConfig): { mesh: PageMesh; report: WeldReport } {
  const sections: PageSourceMeshSection[] = chunks.map((mesh, index) => ({
    kind: "mainTerrain",
    terrainClass: "inland",
    positionSource: "extracted",
    label: `chunk-${index}`,
    mesh,
  }));
  const filtered = filterPageSourceSections(sections);
  return weldVertices(filtered.mesh, cfg.simplify.weld_epsilon_cells, {
    position: cfg.validation.position_epsilon,
    normalDot: cfg.validation.normal_dot_min,
    material: cfg.validation.material_weight_epsilon,
  });
}
