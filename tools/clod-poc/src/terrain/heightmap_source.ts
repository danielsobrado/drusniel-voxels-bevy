// Imported heightmap terrain source (e.g. an Azgaar Fantasy-Map-Generator grayscale export).
//
// This is a FINITE-world authority: when a source is installed, it fully replaces the analytic
// low-frequency shape (continent/mountains/hills/valleys/island) with a bilinear sample of the
// imported raster, plus a small procedural micro-relief so close-up geometry is not faceted.
//
// The single sampler here is called by BOTH canonical CPU fields (terrain_surface.ts
// baseSurfaceHeight and gpu/terrain_field_core_math.ts surfaceHeightCore), so their heightmap
// results are bit-identical by construction — the terrain_field_core parity test stays green
// without duplicating the mapping math. The raster is deliberately kept OUT of TerrainFieldConfig
// (which is JSON-hashed for cache identity); it lives in this module global, mirroring the
// terrainSurfaceOverride / borderCoastRuntime runtime authorities.

import { fbm2 } from "./procedural_noise.js";

export interface HeightmapSource {
  width: number;
  height: number;
  /** width*height luminance in [0,1], row-major, row 0 = image top. */
  data: Float32Array;
  /** World spans [0, worldCells] in both x and z; the raster stretches to fill it. */
  worldCells: number;
  /** Engine surface height at luminance 0. */
  baseM: number;
  /** Additional engine height at luminance 1 (so height = baseM + luminance*spanM). */
  spanM: number;
  /** false: world z=0 maps to the top image row; true: world z=0 maps to the bottom row. */
  flipZ: boolean;
  /** Micro-relief amplitude in metres added on top of the raster sample (0 disables). */
  detailM: number;
  /** Seed for the micro-relief noise. */
  seed: number;
}

/** Matches TERRAIN_CONFIG.height: basins may drop to bedrock, peaks cap just under max. */
const HEIGHT_FLOOR = 1;
const HEIGHT_CEIL = 117.5;

let source: HeightmapSource | null = null;

export function setHeightmapSource(next: HeightmapSource | null): void {
  source = next;
}

export function getHeightmapSource(): HeightmapSource | null {
  return source;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function bilinearLuminance(src: HeightmapSource, u: number, v: number): number {
  const { width, height, data } = src;
  const fx = clamp01(u) * (width - 1);
  const fy = clamp01(v) * (height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = x0 + 1 < width ? x0 + 1 : x0;
  const y1 = y0 + 1 < height ? y0 + 1 : y0;
  const tx = fx - x0;
  const ty = fy - y0;
  const row0 = y0 * width;
  const row1 = y1 * width;
  const a = data[row0 + x0]!;
  const b = data[row0 + x1]!;
  const c = data[row1 + x0]!;
  const d = data[row1 + x1]!;
  const top = a + (b - a) * tx;
  const bot = c + (d - c) * tx;
  return top + (bot - top) * ty;
}

export function sampleHeightmapHeightFrom(src: HeightmapSource, x: number, z: number): number {
  const span = src.worldCells > 0 ? src.worldCells : 1;
  const u = x / span;
  const vRaw = z / span;
  const v = src.flipZ ? 1 - vRaw : vRaw;
  const lum = bilinearLuminance(src, u, v);
  let h = src.baseM + lum * src.spanM;
  if (src.detailM > 0) {
    const d = fbm2(x, z, { scale: 0.1, octaves: 3, persistence: 0.5, lacunarity: 2.0, seed: src.seed + 607 }) * 2 - 1;
    h += d * src.detailM;
  }
  return h < HEIGHT_FLOOR ? HEIGHT_FLOOR : h > HEIGHT_CEIL ? HEIGHT_CEIL : h;
}

/** Height in engine units at (x, z), or null when no heightmap is installed. */
export function sampleHeightmapHeight(x: number, z: number): number | null {
  const src = source;
  if (!src) return null;
  return sampleHeightmapHeightFrom(src, x, z);
}

export interface HeightmapSourceDescriptor {
  width: number;
  height: number;
  worldCells: number;
  baseM: number;
  spanM: number;
  flipZ: boolean;
  detailM: number;
  seed: number;
}

/** Small, JSON-friendly identity of the source (excludes the raster) for the terrain cache key. */
export function describeHeightmapSource(src: HeightmapSource): HeightmapSourceDescriptor {
  return {
    width: src.width,
    height: src.height,
    worldCells: src.worldCells,
    baseM: src.baseM,
    spanM: src.spanM,
    flipZ: src.flipZ,
    detailM: src.detailM,
    seed: src.seed,
  };
}
