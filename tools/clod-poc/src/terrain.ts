// Synthetic terrain stand-in for the engine's Surface Nets chunk mesher.
//
// The builder consumes same-resolution chunk meshes. This standalone viewer generates
// an equivalent: a GLOBAL scalar
// field, meshed PER CHUNK with a halo. Because every vertex/normal/material is a pure
// function of the global field, two chunks that both touch a shared boundary cell emit
// byte-identical copies of that vertex -> they weld cleanly and borders match by
// construction. This is the property the page builder relies on.
//
// Chunking is in X/Z only because terrain is columnar.

import { PageMesh } from "./types.js";
import { ClodPagesConfig } from "./config.js";

const Y_CELLS = 128;
export const WATER_LEVEL = 18;
const MIN_NORMAL_TERRAIN_SURFACE_Y = WATER_LEVEL - 4;
const BASE_TERRAIN_ELEVATION = MIN_NORMAL_TERRAIN_SURFACE_Y;
const TERRAIN_SEED = 0;

const TERRAIN_CONFIG = {
  height: { min: 14, max: 118 },
  continent: { scale: 0.001, amplitude: 40, octaves: 2, persistence: 0.5, lacunarity: 2.0 },
  mountains: {
    scale: 0.008,
    amplitude: 120,
    octaves: 7,
    persistence: 0.48,
    lacunarity: 2.3,
    ridgePower: 1.8,
    massifScale: 0.0035,
    massifAmplitude: 38,
    massifThreshold: 0.38,
    massifPower: 1.65,
  },
  hills: { scale: 0.025, amplitude: 25, octaves: 4, persistence: 0.5, lacunarity: 2.0 },
  detail: { scale: 0.1, amplitude: 3, octaves: 3, persistence: 0.5, lacunarity: 2.0 },
};

/** World cell extent in X/Z. Quads referencing cells outside this are clipped, so the
 *  world's outer pages get a clean open boundary instead of dangling halo geometry. */
export interface WorldBounds {
  cellsX: number;
  cellsZ: number;
}

// ---- global field ---------------------------------------------------------

function hashPositionSeeded(x: number, z: number, seed = TERRAIN_SEED): number {
  let n = (
    Math.imul(x | 0, 374761393) +
    Math.imul(z | 0, 668265263) +
    Math.imul(seed | 0, 1376312589)
  ) | 0;
  n = Math.imul(n ^ (n >> 13), 1274126177);
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}

function smooth(t: number): number {
  t = Math.min(1, Math.max(0, t));
  return t * t * (3 - 2 * t);
}

function smoothstepRange(edge0: number, edge1: number, value: number): number {
  const denominator = edge1 - edge0;
  if (Math.abs(denominator) <= Number.EPSILON) return value >= edge1 ? 1 : 0;
  return smooth((value - edge0) / denominator);
}

function valueNoise2(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = smooth(x - Math.floor(x));
  const zf = smooth(z - Math.floor(z));
  const a = hashPositionSeeded(xi, zi);
  const b = hashPositionSeeded(xi + 1, zi);
  const c = hashPositionSeeded(xi, zi + 1);
  const d = hashPositionSeeded(xi + 1, zi + 1);
  return a + (b - a) * xf + (c - a) * zf + (a - b - c + d) * xf * zf;
}

function fbmConfigurable(
  x: number,
  z: number,
  scale: number,
  octaves: number,
  persistence: number,
  lacunarity: number,
): number {
  let value = 0;
  let amplitude = 1;
  let frequency = scale;
  let maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * valueNoise2(x * frequency, z * frequency);
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return value / maxValue;
}

function ridgedNoise(x: number, z: number): number {
  const cfg = TERRAIN_CONFIG.mountains;
  let value = 0;
  let amplitude = 1;
  let frequency = cfg.scale;
  let maxValue = 0;
  for (let i = 0; i < cfg.octaves; i++) {
    const sample = valueNoise2(x * frequency + i * 100, z * frequency + i * 100);
    const centered = sample * 2 - 1;
    const ridge = Math.pow(1 - Math.abs(centered), cfg.ridgePower);
    value += ridge * amplitude;
    maxValue += amplitude;
    amplitude *= cfg.persistence;
    frequency *= cfg.lacunarity;
  }
  return (value / maxValue) * cfg.amplitude;
}

function massifCellMask(x: number, z: number): number {
  const cfg = TERRAIN_CONFIG.mountains;
  const spacing = Math.min(384, Math.max(128, 1 / Math.max(0.001, cfg.massifScale)));
  const cellX = Math.floor(x / spacing);
  const cellZ = Math.floor(z / spacing);
  let strongest = 0;

  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = cellX + dx;
      const cz = cellZ + dz;
      const offsetX = hashPositionSeeded(Math.imul(cx, 43), Math.imul(cz, 59)) - 0.5;
      const offsetZ = hashPositionSeeded(Math.imul(cx, 71), Math.imul(cz, 37)) - 0.5;
      const heightT = 0.55 + hashPositionSeeded(Math.imul(cx, 97), Math.imul(cz, 83)) * 0.45;
      const radiusT = hashPositionSeeded(Math.imul(cx, 113), Math.imul(cz, 131));
      const centerX = (cx + 0.5 + offsetX * 0.55) * spacing;
      const centerZ = (cz + 0.5 + offsetZ * 0.55) * spacing;
      const radius = spacing * (0.42 + radiusT * 0.22);
      const dist = Math.hypot(x - centerX, z - centerZ);
      const falloff = Math.min(1, Math.max(0, 1 - dist / Math.max(1, radius)));
      const mask = Math.pow(smooth(falloff), Math.max(0.25, cfg.massifPower));
      strongest = Math.max(strongest, mask * heightT);
    }
  }
  return strongest;
}

function softenHeightCap(height: number, minHeight: number, maxHeight: number): number {
  const ceilingStart = Math.max(maxHeight - 18, minHeight);
  const ceiling = maxHeight - 0.5;
  if (height <= ceilingStart || ceiling <= ceilingStart) return height;

  const range = ceiling - ceilingStart;
  const excess = height - ceilingStart;
  return ceilingStart + (range * excess) / (excess + range);
}

export type TerrainSurfaceOverride = (x: number, z: number) => number;

let terrainSurfaceOverride: TerrainSurfaceOverride | null = null;

export function setTerrainSurfaceOverride(override: TerrainSurfaceOverride | null): void {
  terrainSurfaceOverride = override;
}

/** Base procedural terrain surface before runtime dig edits or hydrology carving. */
export function baseSurfaceHeight(x: number, z: number): number {
  const cfg = TERRAIN_CONFIG;
  const continentNoise = fbmConfigurable(
    x,
    z,
    cfg.continent.scale,
    cfg.continent.octaves,
    cfg.continent.persistence,
    cfg.continent.lacunarity,
  );
  const continent = continentNoise * cfg.continent.amplitude * 0.55;

  const mountainSignal = fbmConfigurable(x, z, cfg.mountains.scale * 0.25, 2, 0.5, 2.0);
  const massifSignal = fbmConfigurable(x + 4096, z - 2048, cfg.mountains.massifScale, 3, 0.52, 2.0);
  const massifMask = Math.max(
    Math.pow(
      smoothstepRange(cfg.mountains.massifThreshold, 1.0, massifSignal),
      Math.max(0.25, cfg.mountains.massifPower),
    ),
    massifCellMask(x, z),
  );
  const mountainRegionBase = Math.pow(Math.min(1, Math.max(0, mountainSignal)), 1.35);
  const mountainRegion = Math.min(1, Math.max(0, mountainRegionBase * 0.55 + massifMask * 0.8));
  const mountains = ridgedNoise(x, z) * mountainRegion * (1 + massifMask * 0.55);
  const mountainUplift = cfg.mountains.amplitude * 0.18 * mountainRegion + cfg.mountains.massifAmplitude * massifMask;

  const valleySignal = fbmConfigurable(x + 1375, z - 911, cfg.continent.scale * 2.2, 3, 0.55, 2.0);
  const valleyMask = smoothstepRange(0.22, 0.08, valleySignal);
  const valleyCarve = valleyMask * 14 * (1 - mountainRegion * 0.75);

  const hillNoise = fbmConfigurable(x, z, cfg.hills.scale, cfg.hills.octaves, cfg.hills.persistence, cfg.hills.lacunarity);
  const hills = hillNoise * cfg.hills.amplitude * 0.45;

  const detailNoise = fbmConfigurable(x, z, cfg.detail.scale, cfg.detail.octaves, cfg.detail.persistence, cfg.detail.lacunarity);
  const detail = detailNoise * cfg.detail.amplitude;

  const minSurface = Math.max(cfg.height.min, MIN_NORMAL_TERRAIN_SURFACE_Y);
  const height = BASE_TERRAIN_ELEVATION + continent + mountains + mountainUplift + hills + detail - valleyCarve;
  return Math.min(cfg.height.max - 0.5, Math.max(minSurface, softenHeightCap(height, minSurface, cfg.height.max)));
}

/** Terrain surface height at (x,z). */
export function surfaceHeight(x: number, z: number): number {
  return terrainSurfaceOverride ? terrainSurfaceOverride(x, z) : baseSurfaceHeight(x, z);
}

// ---- dig edits -------------------------------------------------------------
//
// Runtime carve overlay for the terrain lower/dig tool
// (src/terrain/tools/operations.rs): each dig is a sphere of air subtracted from the
// field via CSG min(base, |p-c| - r). The edits stay a pure function of (x,y,z), so
// halo recomputation still emits byte-identical border vertices and welding holds.

export type BrushShape = "sphere" | "cube" | "cylinder";
/** "remove" carves air (CSG subtract); "add" deposits solid (CSG union) tagged `material`. */
export type BrushOp = "remove" | "add";

/** One terraform edit: a brush volume at (x,y,z) of horizontal half-size r, subtracted or added. */
export interface DigEdit {
  x: number;
  y: number;
  z: number;
  r: number;
  shape?: BrushShape; // default "sphere"
  op?: BrushOp; // default "remove"
  material?: number; // add only: terrain texture slot index to paint the deposit with. TODO: Wire to content registry materialId.
  height?: number; // vertical half-extent (cells); default r (sphere becomes an ellipsoid)
  strength?: number; // 0..1 fraction of the full carve/fill applied; default 1 (hard edit)
  falloff?: number; // 0..1 edge softness: feather width as a fraction of r; default 0 (hard edge)
}

/** Carving at or below this height is ignored — analogue of the engine's bedrock guard. */
const BEDROCK_Y = 1;
/** A carve can move the isosurface wherever |p-c| - r < base density; near the surface
 *  |base| stays small, so r + this margin bounds the influence region. */
export const DIG_INFLUENCE_MARGIN = 4;

/**
 * Spatial index for dig edits — O(1) density lookups by cell grid.
 * Cell size = 16 (matches chunk size).
 */
const CELL_SHIFT = 4; // 2^4 = 16
const CELL_SIZE = 16;

type CellKey = number;

function cellKey(x: number, y: number, z: number): CellKey {
  return ((x >> CELL_SHIFT) * 1048576 + (y >> CELL_SHIFT)) * 1048576 + (z >> CELL_SHIFT);
}

function overlappingCells(ex: number, ey: number, ez: number, r: number, h: number): CellKey[] {
  const minX = Math.floor((ex - r) / CELL_SIZE);
  const maxX = Math.floor((ex + r) / CELL_SIZE);
  const minY = Math.floor((ey - h) / CELL_SIZE);
  const maxY = Math.floor((ey + h) / CELL_SIZE);
  const minZ = Math.floor((ez - r) / CELL_SIZE);
  const maxZ = Math.floor((ez + r) / CELL_SIZE);
  const keys: CellKey[] = [];
  for (let cx = minX; cx <= maxX; cx++) {
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        keys.push(((cx * 1048576 + cy) * 1048576 + cz));
      }
    }
  }
  return keys;
}

const editIndex = new Map<CellKey, DigEdit[]>();
let digEditRevision = 0;
const editIds = new WeakMap<DigEdit, number>();
let editIdCounter = 0;

export function addDigEdit(edit: DigEdit): void {
  const id = ++editIdCounter;
  const h = editHeight(edit);
  const r = edit.r + DIG_INFLUENCE_MARGIN;
  for (const key of overlappingCells(edit.x, edit.y, edit.z, r, h)) {
    let bucket = editIndex.get(key);
    if (!bucket) {
      bucket = [];
      editIndex.set(key, bucket);
    }
    const copy = { ...edit };
    editIds.set(copy, id);
    bucket.push(copy);
  }
  digEditRevision++;
}

/** Return all unique edits across all cells (for persistence or diagnostics). */
export function getDigEditsSnapshot(): DigEdit[] {
  const seen = new Set<number>();
  const all: DigEdit[] = [];
  for (const bucket of editIndex.values()) {
    for (const edit of bucket) {
      const id = editIds.get(edit) ?? 0;
      if (!seen.has(id)) {
        seen.add(id);
        all.push(edit);
      }
    }
  }
  return all;
}

/** Replace the runtime edit history without exposing the mutable backing array. */
export function replaceDigEdits(edits: readonly DigEdit[]): void {
  editIndex.clear();
  for (const edit of edits) addDigEdit(edit);
}

export function clearDigEdits(): void {
  editIndex.clear();
  digEditRevision++;
}

export function digEditCount(): number {
  let n = 0;
  for (const bucket of editIndex.values()) n += bucket.length;
  return n;
}

export function getDigEditRevision(): number {
  return digEditRevision;
}

/** Signed distance to a brush volume centred at the offset (dx,dy,dz), horizontal half-size
 *  r and vertical half-size h. Negative inside, positive outside, for every shape. */
function brushSdf(shape: BrushShape | undefined, dx: number, dy: number, dz: number, r: number, h: number): number {
  switch (shape) {
    case "cube": {
      const qx = Math.abs(dx) - r, qy = Math.abs(dy) - h, qz = Math.abs(dz) - r;
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
      return outside + Math.min(Math.max(qx, qy, qz), 0);
    }
    case "cylinder": {
      const dRadial = Math.hypot(dx, dz) - r, dAxial = Math.abs(dy) - h;
      const outside = Math.hypot(Math.max(dRadial, 0), Math.max(dAxial, 0));
      return outside + Math.min(Math.max(dRadial, dAxial), 0);
    }
    default:
      return Math.hypot(dx, (dy * r) / h, dz) - r;
  }
}

/** Vertical half-extent of an edit's brush (defaults to its horizontal radius). */
function editHeight(e: DigEdit): number {
  return e.height ?? e.r;
}

/** density > 0 = solid (below surface), < 0 = air. The isosurface is density = 0. */
export function density(x: number, y: number, z: number): number {
  let d = surfaceHeight(x, z) - y;
  if (editIndex.size > 0 && y > BEDROCK_Y) {
    const key = cellKey(x, y, z);
    const bucket = editIndex.get(key);
    if (bucket) {
      for (const e of bucket) {
        const h = editHeight(e);
        const dx = x - e.x, dy = y - e.y, dz = z - e.z;
        const sdf = brushSdf(e.shape, dx, dy, dz, e.r, h);
        const full = (e.op === "add") ? Math.max(d, -sdf) : Math.min(d, sdf);
        const feather = Math.max(1e-3, (e.falloff ?? 0) * e.r);
        const weight = Math.min(1, Math.max(0, -sdf / feather)) * (e.strength ?? 1);
        d += (full - d) * weight;
      }
    }
  }
  return d;
}

function gradient(x: number, y: number, z: number): [number, number, number] {
  const e = 0.5;
  const gx = density(x + e, y, z) - density(x - e, y, z);
  const gy = density(x, y + e, z) - density(x, y - e, z);
  const gz = density(x, y, z + e) - density(x, y, z - e);
  // Surface normal points toward air (descending density).
  const nx = -gx;
  const ny = -gy;
  const nz = -gz;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

/** Terrain surface normal at (x,z), using the same density gradient as the mesher. */
export function surfaceNormal(x: number, z: number): [number, number, number] {
  return gradient(x, surfaceHeight(x, z), z);
}

/** 4 material weights from slope/height — deterministic, so they match across borders. */
export function materialWeights(y: number, ny: number): [number, number, number, number] {
  void ny;
  const sand = Math.max(0, 1 - Math.abs(y - WATER_LEVEL) / 6);
  const snow = Math.max(0, (y - 88) / 22);
  const rock = Math.max(0, Math.min(1, (y - 48) / 34)) * (1 - snow);
  const grass = Math.max(0, 1 - sand - snow - rock);
  const sum = sand + snow + rock + grass || 1;
  return [grass / sum, rock / sum, sand / sum, snow / sum];
}

/** Deposited-surface vertices sit at the brush boundary (sdf ≈ 0); catch both sides. */
const MATERIAL_PAINT_BAND = 0.75;

/**
 * Per-vertex paint override carried in the mesh `paintSlot` attribute: slot index + 1 for
 * the terrain texture slot of the last `add` edit whose brush contains this vertex, or 0 for
 * natural terrain (which the shader renders with its height bands). Pure function of
 * position, so coincident border vertices agree and the weld holds.
 */
export function paintMaterialAt(x: number, y: number, z: number): number {
  if (editIndex.size > 0) {
    const key = cellKey(x, y, z);
    const bucket = editIndex.get(key);
    if (bucket) {
      for (let i = bucket.length - 1; i >= 0; i--) {
        const e = bucket[i];
        if (e.op !== "add") continue;
        const h = editHeight(e);
        const dx = x - e.x, dy = y - e.y, dz = z - e.z;
        if (brushSdf(e.shape, dx, dy, dz, e.r, h) <= MATERIAL_PAINT_BAND) {
          const slot = Math.max(0, (e.material ?? 0) | 0);
          return slot + 1;
        }
      }
    }
  }
  return 0;
}

/** Up to this many painted materials blend smoothly at any one vertex. */
export const PAINT_BLEND_CHANNELS = 4;

export interface VertexPaint {
  /** Slot index per channel, or -1 for an unused channel. */
  slots: number[];
  /** Coverage 0..1 per channel; the mesh interpolates these for a smooth blend. */
  weights: number[];
}

/** World-space distance over which painted coverage fades into the natural terrain. */
const PAINT_FADE = 3.0;

/**
 * Per-vertex painted-material blend: up to `PAINT_BLEND_CHANNELS` (slot, weight) pairs.
 * An `add` edit assigns its slot to a channel across the whole fade zone (`sdf <= PAINT_FADE`)
 * so the slot *index* stays constant there, while the coverage `weight` falls smoothly from 1
 * (on the deposited surface) to 0 at the fade edge. Slot indices are chosen globally from the
 * active add edits and written even at zero coverage. Keeping them global matters: attributes
 * are interpolated across triangles, and interpolating a layer id toward -1 samples the wrong
 * texture while the weight is still fading. Only the weights should vary by position.
 */
export function paintWeightsAt(x: number, y: number, z: number): VertexPaint {
  const slots = new Array<number>(PAINT_BLEND_CHANNELS).fill(-1);
  const weights = new Array<number>(PAINT_BLEND_CHANNELS).fill(0);

  const bucket = editIndex.size > 0 ? editIndex.get(cellKey(x, y, z)) : undefined;
  if (!bucket) return { slots, weights };

  const channelSlots: number[] = [];
  for (let i = bucket.length - 1; i >= 0 && channelSlots.length < PAINT_BLEND_CHANNELS; i--) {
    const e = bucket[i];
    if (e.op !== "add") continue;
    const slot = Math.max(0, (e.material ?? 0) | 0);
    if (!channelSlots.includes(slot)) channelSlots.push(slot);
  }
  channelSlots.sort((a, b) => a - b);

  for (let c = 0; c < channelSlots.length; c++) slots[c] = channelSlots[c];
  const cover = new Map<number, number>();
  for (let i = bucket.length - 1; i >= 0; i--) {
    const e = bucket[i];
    if (e.op !== "add") continue;
    const h = editHeight(e);
    const dx = x - e.x, dy = y - e.y, dz = z - e.z;
    const sdf = brushSdf(e.shape, dx, dy, dz, e.r, h);
    if (sdf >= PAINT_FADE) continue;
    const t = Math.min(Math.max((sdf - MATERIAL_PAINT_BAND) / (PAINT_FADE - MATERIAL_PAINT_BAND), 0), 1);
    const w = 1 - t * t * (3 - 2 * t);
    if (w <= 0) continue;
    const slot = Math.max(0, (e.material ?? 0) | 0);
    cover.set(slot, Math.max(cover.get(slot) ?? 0, w));
  }
  for (let c = 0; c < channelSlots.length; c++) {
    weights[c] = cover.get(channelSlots[c]) ?? 0;
  }
  return { slots, weights };
}

// ---- per-chunk surface nets ----------------------------------------------

// CCW cell-corner loops around each axis edge (offsets to the cell min-corner).
const QUAD_CELLS: Record<"x" | "y" | "z", [number, number, number][]> = {
  x: [
    [0, -1, -1],
    [0, 0, -1],
    [0, 0, 0],
    [0, -1, 0],
  ],
  y: [
    [-1, 0, -1],
    [-1, 0, 0],
    [0, 0, 0],
    [0, 0, -1],
  ],
  z: [
    [-1, -1, 0],
    [0, -1, 0],
    [0, 0, 0],
    [-1, 0, 0],
  ],
};

interface VertBuf {
  pos: number[];
  nrm: number[];
  mat: number[];
  index: Map<number, number>; // packed cell key -> local vertex index
}

function cellKeySN(ci: number, cj: number, ck: number): number {
  // packs into a single number; ranges are small and non-negative after offset.
  return ((ci + 512) * 2048 + (cj + 512)) * 2048 + (ck + 512);
}

/** Surface-nets vertex for a cell, placed at the average edge crossing. Pure fn of the field. */
function cellVertex(ci: number, cj: number, ck: number): [number, number, number] | null {
  // 8 corner densities
  const d: number[] = [];
  let neg = 0;
  for (let c = 0; c < 8; c++) {
    const x = ci + (c & 1);
    const y = cj + ((c >> 1) & 1);
    const z = ck + ((c >> 2) & 1);
    const v = density(x, y, z);
    d.push(v);
    if (v < 0) neg++;
  }
  if (neg === 0 || neg === 8) return null;

  // 12 edges as (cornerA, cornerB)
  const EDGES: [number, number][] = [
    [0, 1], [2, 3], [4, 5], [6, 7], // x
    [0, 2], [1, 3], [4, 6], [5, 7], // y
    [0, 4], [1, 5], [2, 6], [3, 7], // z
  ];
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const [a, b] of EDGES) {
    const da = d[a], db = d[b];
    if (da < 0 === db < 0) continue;
    const t = da / (da - db);
    const ax = ci + (a & 1), ay = cj + ((a >> 1) & 1), az = ck + ((a >> 2) & 1);
    const bx = ci + (b & 1), by = cj + ((b >> 1) & 1), bz = ck + ((b >> 2) & 1);
    sx += ax + (bx - ax) * t;
    sy += ay + (by - ay) * t;
    sz += az + (bz - az) * t;
    n++;
  }
  return [sx / n, sy / n, sz / n];
}

function getOrAddVertex(buf: VertBuf, ci: number, cj: number, ck: number): number | null {
  const key = cellKeySN(ci, cj, ck);
  const existing = buf.index.get(key);
  if (existing !== undefined) return existing;
  const p = cellVertex(ci, cj, ck);
  if (p === null) return null;
  const [px, py, pz] = p;
  const [nx, ny, nz] = gradient(px, py, pz);
  const paint = paintMaterialAt(px, py, pz);
  const idx = buf.pos.length / 3;
  buf.pos.push(px, py, pz);
  buf.nrm.push(nx, ny, nz);
  buf.mat.push(paint);
  buf.index.set(key, idx);
  return idx;
}

/**
 * Mesh one chunk (owns cell columns [cx*S, (cx+1)*S) x [cz*S, (cz+1)*S), full Y).
 * Quads are owned by half-open base-column intervals so each crossing edge is emitted
 * exactly once globally; referenced halo cells are recomputed identically and weld away.
 */
export function meshChunk(cx: number, cz: number, cfg: ClodPagesConfig, world: WorldBounds): PageMesh {
  const S = cfg.page.chunk_size;
  const buf: VertBuf = { pos: [], nrm: [], mat: [], index: new Map() };
  const indices: number[] = [];

  const x0 = cx * S, x1 = (cx + 1) * S;
  const z0 = cz * S, z1 = (cz + 1) * S;

  // The per-column Y scan band follows the base surface; dig edits can carve crossings
  // far below it, so widen the band for columns a nearby edit can reach.
  // Collect unique edits from all cells whose XZ grid cell overlaps this chunk.
  const visited = new Set<number>();
  const chunkEdits: DigEdit[] = [];
  const minGX = Math.max(0, Math.floor(x0 / CELL_SIZE) - 1);
  const maxGX = Math.floor((x1 - 1) / CELL_SIZE) + 1;
  const minGZ = Math.max(0, Math.floor(z0 / CELL_SIZE) - 1);
  const maxGZ = Math.floor((z1 - 1) / CELL_SIZE) + 1;
  for (let gx = minGX; gx <= maxGX; gx++) {
    for (let gz = minGZ; gz <= maxGZ; gz++) {
      // Iterate Y cells; limit to reasonable Y range to bound the search
      for (let gy = 0; gy < 32; gy++) {
        const key = (gx * 1048576 + gy) * 1048576 + gz;
        const bucket = editIndex.get(key);
        if (!bucket) continue;
        for (const e of bucket) {
          const id = editIds.get(e) ?? 0;
          if (!visited.has(id)) {
            visited.add(id);
            chunkEdits.push(e);
          }
        }
      }
    }
  }

  for (let i = x0; i < x1; i++) {
    for (let k = z0; k < z1; k++) {
      const nearbyHeights = [
        surfaceHeight(i, k),
        surfaceHeight(i + 1, k),
        surfaceHeight(i - 1, k),
        surfaceHeight(i, k + 1),
        surfaceHeight(i, k - 1),
      ];
      let j0 = Math.max(0, Math.floor(Math.min(...nearbyHeights)) - 2);
      let j1 = Math.min(Y_CELLS - 1, Math.ceil(Math.max(...nearbyHeights)) + 2);
      for (const e of chunkEdits) {
        if (Math.abs(i - e.x) > e.r + DIG_INFLUENCE_MARGIN || Math.abs(k - e.z) > e.r + DIG_INFLUENCE_MARGIN) continue;
        const eh = editHeight(e);
        j0 = Math.max(0, Math.min(j0, Math.floor(e.y - eh - DIG_INFLUENCE_MARGIN)));
        j1 = Math.min(Y_CELLS - 1, Math.max(j1, Math.ceil(e.y + eh + DIG_INFLUENCE_MARGIN)));
      }
      for (let j = j0; j <= j1; j++) {
        emitAxis("x", i, j, k, buf, indices, world);
        emitAxis("y", i, j, k, buf, indices, world);
        emitAxis("z", i, j, k, buf, indices, world);
      }
    }
  }

  return {
    positions: new Float32Array(buf.pos),
    normals: new Float32Array(buf.nrm),
    materials: new Float32Array(buf.mat),
    indices: new Uint32Array(indices),
  };
}

function emitAxis(
  axis: "x" | "y" | "z",
  i: number,
  j: number,
  k: number,
  buf: VertBuf,
  indices: number[],
  world: WorldBounds,
): void {
  const dBase = density(i, j, k);
  const tx = axis === "x" ? i + 1 : i;
  const ty = axis === "y" ? j + 1 : j;
  const tz = axis === "z" ? k + 1 : k;
  const dTip = density(tx, ty, tz);
  if (dBase < 0 === dTip < 0) return; // no crossing

  const loop = QUAD_CELLS[axis];
  // Clip at the world perimeter: if any of the 4 cells is outside the world in X/Z,
  // drop the quad so outer pages get a clean open boundary (no x=-0.5 halo geometry).
  for (const [oi, , ok] of loop) {
    const ci = i + oi, ck = k + ok;
    if (ci < 0 || ci >= world.cellsX || ck < 0 || ck >= world.cellsZ) return;
  }
  const v: number[] = [];
  for (const [oi, oj, ok] of loop) {
    const idx = getOrAddVertex(buf, i + oi, j + oj, k + ok);
    if (idx === null) return; // degenerate (shouldn't happen on a clean field)
    v.push(idx);
  }
  // Wind so the front face looks toward air: solid->air along +axis keeps the CCW loop.
  const flip = dBase < dTip;
  if (!flip) {
    indices.push(v[0], v[1], v[2], v[0], v[2], v[3]);
  } else {
    indices.push(v[0], v[2], v[1], v[0], v[3], v[2]);
  }
}
