// WGSL-shaped TypeScript port of the terrain SDF field (src/terrain.ts).
//
// This is the *spec* for the GPU compute mesher: every function here is written the way the
// WGSL is structured — explicit parameters, no module-global dig-edit array, resolved edit
// records instead of optional fields — so the shader in shaders/terrain_field.wgsl is a
// mechanical transliteration of this file. terrain_field_core.test.ts pins this core to the
// canonical f64 CPU field (terrain.ts) to the bit, so any GPU mismatch the user sees in-browser
// is a precision/pipeline issue (f32 vs f64, sqrt-of-dot vs Math.hypot), never a logic error.
//
// Keep the math here byte-identical to terrain.ts. The two are intentionally duplicated: the
// CPU mesher keeps its path, this is the GPU-shaped parallel reference guarded by the test.

import { BrushShape, BrushOp, DigEdit } from "../terrain.js";

// ---- baked constants (mirror terrain.ts) ----------------------------------
const WATER_LEVEL = 18;
const MIN_NORMAL_TERRAIN_SURFACE_Y = WATER_LEVEL - 4;
const BASE_TERRAIN_ELEVATION = MIN_NORMAL_TERRAIN_SURFACE_Y;
const TERRAIN_SEED = 0;
const BEDROCK_Y = 1;
export const DIG_INFLUENCE_MARGIN = 4;

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

// ---- noise (verbatim from terrain.ts) -------------------------------------
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

/** Terrain surface height at (x,z). Mirror of terrain.ts surfaceHeight. */
export function surfaceHeightCore(x: number, z: number): number {
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

// ---- dig edits (resolved for GPU upload) ----------------------------------
export const SHAPE_SPHERE = 0;
export const SHAPE_CUBE = 1;
export const SHAPE_CYLINDER = 2;

/** A dig edit with every optional field resolved — the form uploaded to the GPU storage buffer
 *  and consumed by densityCore. Mirrors the WGSL DigEdit struct field-for-field. */
export interface ResolvedDigEdit {
  x: number;
  y: number;
  z: number;
  r: number;
  h: number; // vertical half-extent (editHeight)
  shape: number; // SHAPE_*
  opAdd: number; // 1 = union solid, 0 = subtract air
  strength: number;
  falloff: number;
  material: number;
}

function shapeId(shape: BrushShape | undefined): number {
  if (shape === "cube") return SHAPE_CUBE;
  if (shape === "cylinder") return SHAPE_CYLINDER;
  return SHAPE_SPHERE;
}

/** Resolve raw edits to GPU-upload records, applying the same defaults as terrain.ts. */
export function resolveDigEdits(edits: readonly DigEdit[]): ResolvedDigEdit[] {
  return edits.map((e) => {
    const h = e.height ?? e.r;
    const op: BrushOp = e.op ?? "remove";
    return {
      x: e.x,
      y: e.y,
      z: e.z,
      r: e.r,
      h,
      shape: shapeId(e.shape),
      opAdd: op === "add" ? 1 : 0,
      strength: e.strength ?? 1,
      falloff: e.falloff ?? 0,
      material: Math.max(0, (e.material ?? 0) | 0),
    };
  });
}

/** Signed distance to a resolved brush volume. Mirror of terrain.ts brushSdf by shape id. */
function brushSdfCore(shape: number, dx: number, dy: number, dz: number, r: number, h: number): number {
  if (shape === SHAPE_CUBE) {
    const qx = Math.abs(dx) - r, qy = Math.abs(dy) - h, qz = Math.abs(dz) - r;
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
    return outside + Math.min(Math.max(qx, qy, qz), 0);
  }
  if (shape === SHAPE_CYLINDER) {
    const dRadial = Math.hypot(dx, dz) - r, dAxial = Math.abs(dy) - h;
    const outside = Math.hypot(Math.max(dRadial, 0), Math.max(dAxial, 0));
    return outside + Math.min(Math.max(dRadial, dAxial), 0);
  }
  return Math.hypot(dx, (dy * r) / h, dz) - r; // sphere -> ellipsoid when h != r
}

/** density > 0 = solid, < 0 = air. Mirror of terrain.ts density with explicit resolved edits. */
export function densityCore(x: number, y: number, z: number, edits: readonly ResolvedDigEdit[]): number {
  let d = surfaceHeightCore(x, z) - y;
  if (edits.length > 0 && y > BEDROCK_Y) {
    for (const e of edits) {
      const reachXZ = e.r + DIG_INFLUENCE_MARGIN, reachY = e.h + DIG_INFLUENCE_MARGIN;
      const dx = x - e.x, dy = y - e.y, dz = z - e.z;
      if (Math.abs(dx) > reachXZ || Math.abs(dy) > reachY || Math.abs(dz) > reachXZ) continue;
      const sdf = brushSdfCore(e.shape, dx, dy, dz, e.r, e.h);
      const full = e.opAdd === 1 ? Math.max(d, -sdf) : Math.min(d, sdf);
      const feather = Math.max(1e-3, e.falloff * e.r);
      const weight = Math.min(1, Math.max(0, -sdf / feather)) * e.strength;
      d += (full - d) * weight;
    }
  }
  return d;
}

/** Deposited-surface vertices sit at the brush boundary (sdf ≈ 0); catch both sides. */
export const MATERIAL_PAINT_BAND = 0.75;

/** Per-vertex paint slot (slot+1 of the last `add` edit covering the point, else 0). Mirror of
 *  terrain.ts paintMaterialAt with resolved edits. */
export function paintMaterialAtCore(x: number, y: number, z: number, edits: readonly ResolvedDigEdit[]): number {
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i];
    if (e.opAdd !== 1) continue;
    const reachXZ = e.r + DIG_INFLUENCE_MARGIN, reachY = e.h + DIG_INFLUENCE_MARGIN;
    const dx = x - e.x, dy = y - e.y, dz = z - e.z;
    if (Math.abs(dx) > reachXZ || Math.abs(dy) > reachY || Math.abs(dz) > reachXZ) continue;
    if (brushSdfCore(e.shape, dx, dy, dz, e.r, e.h) <= MATERIAL_PAINT_BAND) {
      return e.material + 1; // e.material is already max(0, ...|0) from resolveDigEdits
    }
  }
  return 0;
}

/** Surface normal (points toward air) via central-difference gradient. Mirror of terrain.ts. */
export function densityGradientCore(
  x: number,
  y: number,
  z: number,
  edits: readonly ResolvedDigEdit[],
): [number, number, number] {
  const e = 0.5;
  const gx = densityCore(x + e, y, z, edits) - densityCore(x - e, y, z, edits);
  const gy = densityCore(x, y + e, z, edits) - densityCore(x, y - e, z, edits);
  const gz = densityCore(x, y, z + e, edits) - densityCore(x, y, z - e, edits);
  const nx = -gx;
  const ny = -gy;
  const nz = -gz;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}
