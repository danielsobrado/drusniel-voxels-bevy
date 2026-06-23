// LV-1b: Shared coarse terrain summary field.
//
// Mirrors the far-water downsample pattern (farWaterSurface.ts): box-filter the per-page
// height envelope into a coarse grid, then provide samplers for the far shell (LV-2),
// shadow proxy (LV-3), and canopy shell (LV-4).  Cells with no page coverage fall back
// to the cheap far branch of the terrain field (surfaceHeightCore) so the horizon never
// gaps.  Built off the render loop, debounced on page-tree revision — never per-frame.

import * as THREE from "three";
import type { ClodPageNode } from "../types.js";
import { surfaceHeightCore } from "../gpu/terrain_field_core.js";

export interface TerrainSummaryField {
  /** Number of cells per axis in the coarse grid. */
  res: number;
  /** World-space extent per axis (same unit as page footprints — cell units). */
  worldSize: number;
  /** Downsample factor applied over the page grid. */
  farReduceFactor: number;
  /** Min height per cell. */
  heightMin: Float32Array;
  /** Max height per cell. */
  heightMax: Float32Array;
  /** Normal X per cell (average over covered vertices). */
  normalX: Float32Array;
  /** Normal Y per cell. */
  normalY: Float32Array;
  /** Normal Z per cell. */
  normalZ: Float32Array;
  /** Coverage per cell (0 = no page, 1 = fully covered by page envelopes). */
  coverage: Float32Array;
}

function gridIndex(res: number, x: number, z: number): number {
  return z * res + x;
}

/** World-space X/Z for cell center (fx, fz) in a res×res grid covering [0, worldSize). */
function cellCenter(res: number, worldSize: number, fx: number, fz: number): [number, number] {
  const cellSize = worldSize / res;
  return [(fx + 0.5) * cellSize, (fz + 0.5) * cellSize];
}

/**
 * Build the terrain summary from the CLOD page tree.
 *
 * @param allNodes  All rendered or build-time ClodPageNode[] (flattened from nodesByLevel)
 * @param worldSize World extent in cell units (WORLD * chunks_per_page * chunk_size)
 * @param farReduceFactor  Downsample factor (e.g. 8 → res = worldPages / 8)
 * @returns The summary field with height, normal, and coverage channels
 */
export function buildTerrainSummary(
  allNodes: readonly ClodPageNode[],
  worldSize: number,
  farReduceFactor: number,
): TerrainSummaryField {
  const reduce = Math.max(1, Math.floor(farReduceFactor));
  // LOD0 page grid resolution
  const pageRes = Math.max(1, Math.floor(worldSize));
  const res = Math.max(1, Math.floor(pageRes / reduce));
  const summaryRes = res;

  const heightMin = new Float32Array(summaryRes * summaryRes).fill(Number.POSITIVE_INFINITY);
  const heightMax = new Float32Array(summaryRes * summaryRes).fill(Number.NEGATIVE_INFINITY);
  const normalX = new Float32Array(summaryRes * summaryRes).fill(0);
  const normalY = new Float32Array(summaryRes * summaryRes).fill(0);
  const normalZ = new Float32Array(summaryRes * summaryRes).fill(0);
  const coverage = new Float32Array(summaryRes * summaryRes).fill(0);

  const cellSize = worldSize / summaryRes;

  // Phase 1: accumulate per-cell min/max from page bounds (same box-reduce as farWaterSurface)
  for (const node of allNodes) {
    const f = node.footprint;
    // Map page footprint to summary grid cells
    const fx0 = Math.floor((f.minX / worldSize) * summaryRes);
    const fz0 = Math.floor((f.minZ / worldSize) * summaryRes);
    const fx1 = Math.ceil((f.maxX / worldSize) * summaryRes);
    const fz1 = Math.ceil((f.maxZ / worldSize) * summaryRes);

    for (let fz = Math.max(0, fz0); fz < Math.min(summaryRes, fz1); fz++) {
      for (let fx = Math.max(0, fx0); fx < Math.min(summaryRes, fx1); fx++) {
        const idx = gridIndex(summaryRes, fx, fz);
        heightMin[idx] = Math.min(heightMin[idx], node.bounds.minY);
        heightMax[idx] = Math.max(heightMax[idx], node.bounds.maxY);
        // Mark coverage for cells touched by pages
        coverage[idx] = Math.min(1, coverage[idx] + 1);
      }
    }
  }

  // Phase 2: fill uncovered cells with surfaceHeightCore fallback
  for (let fz = 0; fz < summaryRes; fz++) {
    for (let fx = 0; fx < summaryRes; fx++) {
      const idx = gridIndex(summaryRes, fx, fz);
      if (!Number.isFinite(heightMin[idx])) {
        // No page coverage — sample the analytic terrain field
        const [wx, wz] = cellCenter(summaryRes, worldSize, fx, fz);
        const y = surfaceHeightCore(wx, wz);
        heightMin[idx] = y;
        heightMax[idx] = y;
      }
    }
  }

  // Phase 3: compute normals via central-difference on the final height field
  // Use max-height field for the normal direction (the "surface" visible from afar)
  for (let fz = 0; fz < summaryRes; fz++) {
    for (let fx = 0; fx < summaryRes; fx++) {
      const idx = gridIndex(summaryRes, fx, fz);
      const hL = heightMax[gridIndex(summaryRes, Math.max(0, fx - 1), fz)];
      const hR = heightMax[gridIndex(summaryRes, Math.min(summaryRes - 1, fx + 1), fz)];
      const hD = heightMax[gridIndex(summaryRes, fx, Math.max(0, fz - 1))];
      const hU = heightMax[gridIndex(summaryRes, fx, Math.min(summaryRes - 1, fz + 1))];
      const nx = (hL - hR) / (2 * cellSize);
      const ny = 1;
      const nz = (hD - hU) / (2 * cellSize);
      const len = Math.hypot(nx, ny, nz) || 1;
      normalX[idx] = nx / len;
      normalY[idx] = ny / len;
      normalZ[idx] = nz / len;
    }
  }

  return { res: summaryRes, worldSize, farReduceFactor: reduce, heightMin, heightMax, normalX, normalY, normalZ, coverage };
}

/** Sample height at world position (x, z). Bilinear interpolation. */
export function sampleHeight(field: TerrainSummaryField, x: number, z: number): number {
  const fx = (x / field.worldSize) * field.res - 0.5;
  const fz = (z / field.worldSize) * field.res - 0.5;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const h = (lx: number, lz: number) => {
    const cx = Math.min(field.res - 1, Math.max(0, lx));
    const cz = Math.min(field.res - 1, Math.max(0, lz));
    return field.heightMax[gridIndex(field.res, cx, cz)];
  };
  return h(ix, iz) * (1 - tx) * (1 - tz)
    + h(ix + 1, iz) * tx * (1 - tz)
    + h(ix, iz + 1) * (1 - tx) * tz
    + h(ix + 1, iz + 1) * tx * tz;
}

/**
 * Sample blended height at world position (x, z).
 *
 * Per corner, interpolates `mix(heightMin, heightMax, bias)`, then bilinearly blends across
 * the cell.  bias=0 → valley floor (heightMin), bias=1 → peak (heightMax = sampleHeight).
 * Gives heightMin a consumer (previously dead) and lets callers place geometry at a
 * representative mid-surface height instead of always floating at the peak.
 */
export function sampleHeightBlend(field: TerrainSummaryField, x: number, z: number, bias: number): number {
  const clamped = Math.max(0, Math.min(1, bias));
  const fx = (x / field.worldSize) * field.res - 0.5;
  const fz = (z / field.worldSize) * field.res - 0.5;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const h = (lx: number, lz: number) => {
    const cx = Math.min(field.res - 1, Math.max(0, lx));
    const cz = Math.min(field.res - 1, Math.max(0, lz));
    const idx = gridIndex(field.res, cx, cz);
    return field.heightMin[idx] + (field.heightMax[idx] - field.heightMin[idx]) * clamped;
  };
  return h(ix, iz) * (1 - tx) * (1 - tz)
    + h(ix + 1, iz) * tx * (1 - tz)
    + h(ix, iz + 1) * (1 - tx) * tz
    + h(ix + 1, iz + 1) * tx * tz;
}

/** Sample normal at world position (x, z). Bilinear interpolation. */
export function sampleNormal(field: TerrainSummaryField, x: number, z: number): [number, number, number] {
  const fx = (x / field.worldSize) * field.res - 0.5;
  const fz = (z / field.worldSize) * field.res - 0.5;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const n = (lx: number, lz: number, ci: number): number => {
    const cx = Math.min(field.res - 1, Math.max(0, lx));
    const cz = Math.min(field.res - 1, Math.max(0, lz));
    const arr = ci === 0 ? field.normalX : ci === 1 ? field.normalY : field.normalZ;
    return arr[gridIndex(field.res, cx, cz)];
  };
  return [
    n(ix, iz, 0) * (1 - tx) * (1 - tz) + n(ix + 1, iz, 0) * tx * (1 - tz) + n(ix, iz + 1, 0) * (1 - tx) * tz + n(ix + 1, iz + 1, 0) * tx * tz,
    n(ix, iz, 1) * (1 - tx) * (1 - tz) + n(ix + 1, iz, 1) * tx * (1 - tz) + n(ix, iz + 1, 1) * (1 - tx) * tz + n(ix + 1, iz + 1, 1) * tx * tz,
    n(ix, iz, 2) * (1 - tx) * (1 - tz) + n(ix + 1, iz, 2) * tx * (1 - tz) + n(ix, iz + 1, 2) * (1 - tx) * tz + n(ix + 1, iz + 1, 2) * tx * tz,
  ];
}

/** Sample coverage at world position (x, z). Bilinear interpolation. 0 = no pages, 1 = fully covered. */
export function sampleCoverage(field: TerrainSummaryField, x: number, z: number): number {
  const fx = (x / field.worldSize) * field.res - 0.5;
  const fz = (z / field.worldSize) * field.res - 0.5;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const c = (lx: number, lz: number) => {
    const cx = Math.min(field.res - 1, Math.max(0, lx));
    const cz = Math.min(field.res - 1, Math.max(0, lz));
    return field.coverage[gridIndex(field.res, cx, cz)];
  };
  return c(ix, iz) * (1 - tx) * (1 - tz)
    + c(ix + 1, iz) * tx * (1 - tz)
    + c(ix, iz + 1) * (1 - tx) * tz
    + c(ix + 1, iz + 1) * tx * tz;
}

/**
 * Create a GPU-sampleable height texture from the terrain summary.
 *
 * This mirrors the heightfield texture pattern (r32float StorageTexture).
 * The texture is sampled in TSL vertex shaders for the shadow proxy (LV-3)
 * and far shell (LV-2) position nodes.
 *
 * Layout: row-major res×res, red channel = max height.
 * UV mapping: uv = worldXZ / worldSize + 0.5 (standard heightfield UV convention).
 */
export function createHeightTexture(field: TerrainSummaryField): THREE.DataTexture {
  const { res, heightMax } = field;
  // r32float: one float per texel, stored as Red channel
  const data = new Float32Array(res * res);
  for (let i = 0; i < res * res; i++) {
    data[i] = heightMax[i];
  }
  const tex = new THREE.DataTexture(data, res, res, THREE.RedFormat, THREE.FloatType);
  tex.needsUpdate = true;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Lowest finite cell height in the summary — the recede target for the far skirt. */
export function summaryBaseLevel(field: TerrainSummaryField): number {
  let base = Number.POSITIVE_INFINITY;
  for (let i = 0; i < field.heightMin.length; i++) {
    const v = field.heightMin[i];
    if (Number.isFinite(v)) base = Math.min(base, v);
  }
  return Number.isFinite(base) ? base : 0;
}

/**
 * Far-skirt surface height at world (x, z).
 *
 * Inside the summary footprint [0, worldSize] the height comes from the baked summary
 * (sampleHeightBlend); beyond it, from the analytic field (surfaceHeightCore), which continues
 * infinitely.  The two cross-fade over a band near the world edge so the skirt joins the pages
 * seamlessly.  Past the edge the height also recedes gently toward `baseLevel` (distance from the
 * world edge → `farRadius`) so distant land sinks toward the horizon instead of extruding the
 * edge height flat.
 *
 * @param farRadius  Skirt half-extent in world units (controls the recede rate).
 * @param baseLevel  Recede target (see summaryBaseLevel).
 * @param bias       Height bias passed to sampleHeightBlend (0 = valley, 1 = peak).
 */
export function sampleSkirtHeight(
  field: TerrainSummaryField,
  x: number,
  z: number,
  farRadius: number,
  baseLevel: number,
  bias: number,
): number {
  const worldSize = field.worldSize;
  const baked = sampleHeightBlend(field, x, z, bias);
  const analytic = surfaceHeightCore(x, z);
  // signed inset from the world square boundary: >0 inside, <=0 at/beyond the edge
  const inner = Math.min(Math.min(x, worldSize - x), Math.min(z, worldSize - z));
  const edgeBand = worldSize * 0.1;
  const blend = clamp01(inner / edgeBand); // 1 well inside → baked, 0 at/beyond edge → analytic
  let h = analytic + (baked - analytic) * blend;
  const outside = Math.max(0, -inner);
  const farFactor = clamp01(outside / (farRadius * 0.9));
  h += (baseLevel - h) * farFactor * 0.6;
  return h;
}

/** Skirt grid resolution covering [center-farRadius, center+farRadius], scaled from the summary. */
function extendedRes(field: TerrainSummaryField, farRadius: number): number {
  const extent = 2 * farRadius;
  return Math.max(field.res, Math.min(512, Math.round(field.res * (extent / field.worldSize))));
}

/**
 * Height texture covering the far-skirt extent [center-farRadius, center+farRadius]
 * (center = worldSize/2).  Interior texels mirror createHeightTexture (peak height); exterior
 * texels come from the analytic field, cross-faded near the world edge and receding toward the
 * base level (see sampleSkirtHeight).  Consumed by the LV-4 canopy shell as the base terrain
 * height beyond page coverage.  UV mapping: uv = (worldXZ - (center - farRadius)) / (2*farRadius).
 */
export function createExtendedHeightTexture(field: TerrainSummaryField, farRadius: number): THREE.DataTexture {
  const worldSize = field.worldSize;
  const center = worldSize / 2;
  const extent = 2 * farRadius;
  const origin = center - farRadius;
  const res = extendedRes(field, farRadius);
  const baseLevel = summaryBaseLevel(field);
  const data = new Float32Array(res * res);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const wx = origin + ((i + 0.5) / res) * extent;
      const wz = origin + ((j + 0.5) / res) * extent;
      data[j * res + i] = sampleSkirtHeight(field, wx, wz, farRadius, baseLevel, 1);
    }
  }
  const tex = new THREE.DataTexture(data, res, res, THREE.RedFormat, THREE.FloatType);
  tex.needsUpdate = true;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * Canopy coverage texture covering the far-skirt extent (same UV mapping as
 * createExtendedHeightTexture).  Forest patches come from a low-frequency region noise; inside
 * the world they are gated by page coverage, beyond it terrain exists analytically (gate = 1) so
 * the forest continues outward.  Coverage dissolves toward the far rim
 * so the canopy fades into haze instead of ending at a hard ring.
 */
export function createExtendedCanopyTexture(field: TerrainSummaryField, farRadius: number, seed = 42): THREE.DataTexture {
  const worldSize = field.worldSize;
  const center = worldSize / 2;
  const extent = 2 * farRadius;
  const origin = center - farRadius;
  const res = extendedRes(field, farRadius);

  const hash = (x: number, y: number, s: number): number => {
    const n = Math.sin(x * 127.1 + y * 311.7 + s * 113.5) * 43758.5453;
    return n - Math.floor(n);
  };
  const fbm = (x: number, y: number): number => {
    let v = 0;
    let amp = 0.5;
    let fx = x;
    let fy = y;
    for (let i = 0; i < 2; i++) {
      v += amp * (Math.sin(fx) + Math.sin(fy * 1.3)) * 0.5;
      fx *= 2;
      fy *= 2;
      amp *= 0.5;
    }
    return v;
  };
  const smooth01 = (edge0: number, edge1: number, t: number): number => {
    const v = clamp01((t - edge0) / (edge1 - edge0));
    return v * v * (3 - 2 * v);
  };

  const data = new Float32Array(res * res);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const wx = origin + ((i + 0.5) / res) * extent;
      const wz = origin + ((j + 0.5) / res) * extent;
      // Region noise in summary-cell space so patch size is stable across the extent.
      const sx = (wx / worldSize) * field.res;
      const sz = (wz / worldSize) * field.res;
      const region = (fbm(sx * 0.03, sz * 0.03) + 0.75) / 1.5;
      const forest = smooth01(0.45, 0.65, region);
      const detail = hash(sx * 0.07, sz * 0.07, seed) * 0.3 + fbm(sx * 0.02, sz * 0.02) * 0.2;
      const inside = wx >= 0 && wx <= worldSize && wz >= 0 && wz <= worldSize;
      const exists = inside ? sampleCoverage(field, wx, wz) : 1;
      let c = exists * forest * (0.7 + detail);
      const distFromCenter = Math.hypot(wx - center, wz - center);
      c *= 1 - smooth01(farRadius * 0.7, farRadius * 0.98, distFromCenter);
      data[j * res + i] = clamp01(c);
    }
  }
  const tex = new THREE.DataTexture(data, res, res, THREE.RedFormat, THREE.FloatType);
  tex.needsUpdate = true;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}
