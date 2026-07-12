import { baseSurfaceHeight, type TerrainSurfaceOverride } from "./terrain_surface.js";

// Explicit startup-world heightfield raster cache (NOT a hydrology-carve side effect).
//
// Unified startup hydrology (Phase 3b) removed the legacy carved-grid terrain override, so
// every surfaceHeight() sample during the startup world build fell through to the full
// procedural noise field. This raster restores the array-lookup fast path the legacy carve
// provided, while keeping the procedural terrain field the geometry authority:
//
// - It samples baseSurfaceHeight at EXACT cell resolution (one f64 sample per integer cell
//   corner). The Surface Nets mesher reads corner densities only at integer lattice coords,
//   so vertex POSITIONS built through the raster are bit-identical to direct procedural
//   evaluation — none of the low-pass the coarse legacy hydrology grid applied.
// - Fractional (x, z) samples (normal gradients at ±0.5 offsets, prop/collider queries) get
//   bilinear reconstruction between exact lattice samples instead of the true field.
// - Outside the padded startup-world domain it falls back to baseSurfaceHeight, matching the
//   bounded semantics streamed roots and live chunks already use.
//
// The raster is a pure function of already cache-keyed inputs (terrain field config, seed,
// startup world size), so cache identity carries only its descriptor, never its contents.

export interface StartupHeightfieldRaster {
  /** Startup world span in cells (X == Z). */
  worldCells: number;
  /** First sampled lattice coordinate (== -padding). */
  minCell: number;
  /** Samples per axis; the lattice covers [minCell, minCell + res - 1]. */
  res: number;
  /** res*res row-major (z * res + x) exact f64 samples of baseSurfaceHeight. */
  heights: Float64Array;
}

/** Plain descriptor for cache identity; contents are derived, so they are never hashed. */
export interface StartupHeightfieldDescriptor {
  worldCells: number;
  minCell: number;
  res: number;
}

// Chunk meshing samples one cell beyond the chunk (nearbyHeights at i±1) and normal
// gradients another 0.5 beyond that, so pad the lattice two cells past the world bounds.
export const STARTUP_HEIGHTFIELD_PADDING_CELLS = 2;

export function buildStartupHeightfieldRaster(
  worldCells: number,
  sample: (x: number, z: number) => number = baseSurfaceHeight,
): StartupHeightfieldRaster {
  const minCell = -STARTUP_HEIGHTFIELD_PADDING_CELLS;
  const res = worldCells + STARTUP_HEIGHTFIELD_PADDING_CELLS * 2 + 1;
  const heights = new Float64Array(res * res);
  for (let iz = 0; iz < res; iz++) {
    const z = minCell + iz;
    const row = iz * res;
    for (let ix = 0; ix < res; ix++) heights[row + ix] = sample(minCell + ix, z);
  }
  return { worldCells, minCell, res, heights };
}

export function startupHeightfieldDescriptor(
  raster: StartupHeightfieldRaster | null,
): StartupHeightfieldDescriptor | null {
  if (!raster) return null;
  return { worldCells: raster.worldCells, minCell: raster.minCell, res: raster.res };
}

export function makeStartupHeightfieldSampler(raster: StartupHeightfieldRaster): TerrainSurfaceOverride {
  const { minCell, res, heights } = raster;
  const maxCell = minCell + res - 1;
  return (x, z) => {
    if (x < minCell || z < minCell || x > maxCell || z > maxCell) return baseSurfaceHeight(x, z);
    const gx = x - minCell;
    const gz = z - minCell;
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const fx = gx - x0;
    const fz = gz - z0;
    const h00 = heights[z0 * res + x0]!;
    // Integer lattice reads return the stored sample untouched so mesher corner densities
    // stay bit-identical to direct procedural evaluation.
    if (fx === 0 && fz === 0) return h00;
    const x1 = Math.min(res - 1, x0 + 1);
    const z1 = Math.min(res - 1, z0 + 1);
    const h10 = heights[z0 * res + x1]!;
    const h01 = heights[z1 * res + x0]!;
    const h11 = heights[z1 * res + x1]!;
    const a = h00 * (1 - fx) + h10 * fx;
    const b = h01 * (1 - fx) + h11 * fx;
    return a * (1 - fz) + b * fz;
  };
}
