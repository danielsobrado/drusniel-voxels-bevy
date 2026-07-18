import type { TerrainHeightSampler } from "./waterField.js";
import {
  HYDROLOGY_BODY_DRY,
  HYDROLOGY_BODY_LAKE,
  HYDROLOGY_BODY_POND,
  HYDROLOGY_BODY_RIVER,
  type HydrologySample,
} from "./hydrologyGrid.js";

const BASIN_SIZE_M = 768;
const LAKE_RADIUS_MIN_M = 42;
const LAKE_RADIUS_MAX_M = 118;
const RIVER_WIDTH_MIN_M = 10;
const RIVER_WIDTH_MAX_M = 28;
const RIVER_LEVEL_OFFSET_M = 1.25;
const DRY_DEPTH_M = 16;
const HASH_UINT_SCALE = 1 / 0xffffffff;

// Terrain-driven channel tracing (Phase 3b): each spawned basin seeds one channel that
// follows the terrain gradient downhill. The trace is a pure function of the basin
// coordinates and the terrain sampler, so every tile/sample reconstructs the identical
// polyline — seam-free by construction.
const RIVER_SPAWN_THRESHOLD = 0.85;
const RIVER_TRACE_STEPS = 72;
const RIVER_TRACE_STEP_M = 24;
const RIVER_GRAD_STEP_M = 12;
const RIVER_MIN_TRACE_POINTS = 6;
/** Stop tracing when the local slope falls below this (m per m): reached a flat/basin. */
const RIVER_FLAT_SLOPE_STOP = 0.005;
const RIVER_TRACE_INERTIA = 0.55;
/** Absolute downstream distance over which the channel widens MIN -> MAX. Widths are a
 *  function of distance from the seed, not trace fraction, so short traces stay narrow
 *  (an accumulation proxy) and confluences of long channels read as real rivers. */
const RIVER_WIDTH_RAMP_M = 1152;
/**
 * Channel search radius in basins. Must satisfy: max seed-to-sample distance a channel
 * can bridge (trace length + half-width = 72*24 + 28 ≈ 1.76 km) < (radius - 0.5+) *
 * BASIN_SIZE_M, so a sample near a channel tail still finds the seed basin
 * (radius 3 -> 1920 m guaranteed).
 */
const RIVER_SEARCH_RADIUS_BASINS = 3;
/** Bounded memo of traced channels; rebuilt entries are bit-identical (pure function). */
const CHANNEL_MEMO_MAX = 512;

export interface InfiniteHydrologyOptions {
  drySentinelDepthM?: number;
  /** Terrain carve the terrain authority applies (same shape as the graph carve config).
   *  When set, samples report the carved bed as terrainY so wet masks and depths agree
   *  with the rendered terrain; when null/absent, samples sit on the raw field (legacy). */
  carve?: InfiniteHydrologyCarveConfig | null;
}

/** Structurally identical to GraphTerrainCarveConfig; duplicated to keep this module
 *  free of graph imports (it must stay loadable in every worker). */
export interface InfiniteHydrologyCarveConfig {
  readonly depthM: number;
  readonly power: number;
  readonly lakeBedDepthM: number;
}

function hash2u(ix: number, iz: number, salt: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}

function hash2(ix: number, iz: number, salt: number): number {
  return hash2u(ix, iz, salt) * HASH_UINT_SCALE;
}

// Deterministic non-zero body id for a procedural basin body. Stable per basin so
// invariant checks see wet cells carrying a real id; not globally connected (Phase 3
// replaces this fallback with the tile authority that supplies true connected ids).
function basinBodyId(cx: number, cz: number, salt: number): number {
  return (hash2u(cx, cz, salt) % 0x7ffffffe) + 1;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (Math.abs(edge1 - edge0) <= Number.EPSILON) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function mix(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t;
}

function basinCoord(value: number): number {
  return Math.floor(value / BASIN_SIZE_M);
}

function basinCenter(coord: number, jitter: number): number {
  return (coord + 0.5 + (jitter - 0.5) * 0.52) * BASIN_SIZE_M;
}

function drySample(terrainY: number, dryDepthM: number): HydrologySample {
  return {
    terrainY,
    waterY: terrainY - dryDepthM,
    depth: 0,
    bodyMask: 0,
    lakeMask: 0,
    riverMask: 0,
    flowX: 0,
    flowZ: 0,
    flowStrength: 0,
    riverDepth: 0,
    waterYFar: terrainY - dryDepthM,
    moisture: 0.18,
    bodyKind: HYDROLOGY_BODY_DRY,
    bodyId: 0,
    shoreDistance: 0,
  };
}

// Rim samples used to validate a basin: the lake level may never exceed the lowest
// point of its rim, otherwise water would hang above the downhill slope outside it.
const LAKE_RIM_SAMPLES = 8;
const LAKE_RIM_MARGIN_M = 0.4;
const LAKE_MIN_DEPRESSION_M = 1.0;
const LAKE_DESCENT_STEP_M = 72;
const LAKE_DESCENT_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [LAKE_DESCENT_STEP_M, 0],
  [-LAKE_DESCENT_STEP_M, 0],
  [0, LAKE_DESCENT_STEP_M],
  [0, -LAKE_DESCENT_STEP_M],
];

/**
 * Spill level for a candidate basin, or null when the disc is not a real depression.
 * Contained means: the terrain at the centre sits at least LAKE_MIN_DEPRESSION_M below
 * the lowest rim sample; the water fills half the depression, capped under the rim so the
 * waterline always closes inside the disc (no floating sheet past the downhill rim).
 */
function lakeSpillLevel(centerX: number, centerZ: number, radius: number, sampler: TerrainHeightSampler): number | null {
  const centerY = sampler.surfaceHeight(centerX, centerZ);
  let rimMin = Number.POSITIVE_INFINITY;
  for (let k = 0; k < LAKE_RIM_SAMPLES; k++) {
    const a = (k / LAKE_RIM_SAMPLES) * Math.PI * 2;
    rimMin = Math.min(rimMin, sampler.surfaceHeight(centerX + Math.cos(a) * radius, centerZ + Math.sin(a) * radius));
  }
  if (rimMin < centerY + LAKE_MIN_DEPRESSION_M) return null; // slope, not a basin
  return Math.min(centerY + (rimMin - centerY) * 0.5, rimMin - LAKE_RIM_MARGIN_M);
}

interface ResolvedBasin {
  centerX: number;
  centerZ: number;
  radius: number;
  waterY: number;
  /** True when the basin spawns as a lake (spawn < 0.15); ponds otherwise. */
  isLake: boolean;
  kind: number;
  id: number;
}

/**
 * Per-sampler memo of resolved lake basins. A basin's refined centre, radius, and spill
 * level are a pure function of (basin coords, sampler) — the descent and rim validation
 * never depend on the query point — so hoisting them here changes no output, only cost.
 */
const basinMemos = new WeakMap<TerrainHeightSampler, Map<number, ResolvedBasin | null>>();
const BASIN_MEMO_MAX = 512;

/** Collision-free numeric key for basin coords (avoids per-lookup string allocation on
 *  the hot terrain-carve path). Valid for |coord| < 2^20 basins (~±800,000 km). */
function basinKey(cx: number, cz: number): number {
  return (cx + 0x100000) * 0x200000 + (cz + 0x100000);
}

function resolveBasin(cx: number, cz: number, sampler: TerrainHeightSampler): ResolvedBasin | null {
  const spawn = hash2(cx, cz, 11);
  if (spawn > 0.55) return null;
  let centerX = basinCenter(cx, hash2(cx, cz, 17));
  let centerZ = basinCenter(cz, hash2(cx, cz, 23));
  const radius = mix(LAKE_RADIUS_MIN_M, LAKE_RADIUS_MAX_M, hash2(cx, cz, 31));
  // Deterministic descent: hashed centres rarely coincide with real depressions on
  // hilly terrain, so walk the centre toward the local low spot before validating the
  // basin. Same inputs -> same descent -> same lake for every sample/tile.
  for (let step = 0; step < 2; step++) {
    let lowY = sampler.surfaceHeight(centerX, centerZ);
    let moveX = centerX;
    let moveZ = centerZ;
    for (const [ddx, ddz] of LAKE_DESCENT_OFFSETS) {
      const px = centerX + ddx;
      const pz = centerZ + ddz;
      const py = sampler.surfaceHeight(px, pz);
      if (py < lowY) {
        lowY = py;
        moveX = px;
        moveZ = pz;
      }
    }
    if (moveX === centerX && moveZ === centerZ) break;
    centerX = moveX;
    centerZ = moveZ;
  }
  const waterY = lakeSpillLevel(centerX, centerZ, radius, sampler);
  if (waterY === null) return null; // invalid basin: reject the lake rather than forcing it
  return {
    centerX,
    centerZ,
    radius,
    waterY,
    isLake: spawn < 0.15,
    kind: spawn < 0.15 ? HYDROLOGY_BODY_LAKE : HYDROLOGY_BODY_POND,
    id: basinBodyId(cx, cz, 41),
  };
}

function getBasin(cx: number, cz: number, sampler: TerrainHeightSampler): ResolvedBasin | null {
  let memo = basinMemos.get(sampler);
  if (!memo) {
    memo = new Map();
    basinMemos.set(sampler, memo);
  }
  const key = basinKey(cx, cz);
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  const resolved = resolveBasin(cx, cz, sampler);
  if (memo.size >= BASIN_MEMO_MAX) {
    const oldest = memo.keys().next().value as number;
    memo.delete(oldest);
  }
  memo.set(key, resolved);
  return resolved;
}

/** Per-sampler memo of the 3×3 basin neighbourhood around a centre basin cell, in the
 *  same oz-outer/ox-inner order the direct loop used (order is part of the tie-break
 *  contract). One lookup replaces nine on the hot per-sample path. */
const basinHoodMemos = new WeakMap<TerrainHeightSampler, Map<number, ResolvedBasin[]>>();

function getBasinHood(bx: number, bz: number, sampler: TerrainHeightSampler): ResolvedBasin[] {
  let memo = basinHoodMemos.get(sampler);
  if (!memo) {
    memo = new Map();
    basinHoodMemos.set(sampler, memo);
  }
  const key = basinKey(bx, bz);
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  const hood: ResolvedBasin[] = [];
  for (let oz = -1; oz <= 1; oz++) {
    for (let ox = -1; ox <= 1; ox++) {
      const basin = getBasin(bx + ox, bz + oz, sampler);
      if (basin) hood.push(basin);
    }
  }
  if (memo.size >= BASIN_MEMO_MAX) {
    const oldest = memo.keys().next().value as number;
    memo.delete(oldest);
  }
  memo.set(key, hood);
  return hood;
}

interface BasinHit {
  basin: ResolvedBasin;
  distance: number;
  mask: number;
}

/** Basins whose disc contains (x, z), across the 3×3 basin neighbourhood.
 *  Hard containment at the rim radius: no fade band outside it, otherwise terrain
 *  that falls away past the rim would carry floating water. Shoreline softness comes
 *  from the depth->0 crossing inside the basin, not from the radial mask. */
function collectBasinHits(x: number, z: number, sampler: TerrainHeightSampler): BasinHit[] {
  const hood = getBasinHood(basinCoord(x), basinCoord(z), sampler);
  const hits: BasinHit[] = [];
  for (const basin of hood) {
    const distance = Math.hypot(x - basin.centerX, z - basin.centerZ);
    if (distance > basin.radius) continue;
    hits.push({
      basin,
      distance,
      mask: 1 - smoothstep(basin.radius * 0.82, basin.radius, distance),
    });
  }
  return hits;
}

function lakeCandidate(terrainY: number, basins: readonly BasinHit[]): HydrologySample | null {
  let best: BasinHit | null = null;
  for (const hit of basins) {
    if (hit.mask <= (best?.mask ?? 0)) continue;
    best = hit;
  }
  if (!best) return null;
  const wet = best.basin.waterY > terrainY;
  if (!wet) return null; // basin water surface is below local terrain here: dry ground, not floating water.
  const waterY = best.basin.waterY;
  const bodyMask = best.mask;
  return {
    terrainY,
    waterY,
    depth: waterY - terrainY,
    bodyMask,
    lakeMask: best.basin.isLake ? best.mask : 0,
    riverMask: 0,
    flowX: 0,
    flowZ: 0,
    flowStrength: 0,
    riverDepth: 0,
    waterYFar: waterY,
    moisture: Math.max(0.24, bodyMask),
    bodyKind: best.basin.kind,
    bodyId: best.basin.id,
    shoreDistance: Math.max(0, best.basin.radius - best.distance),
  };
}

interface ChannelVertex {
  x: number;
  z: number;
  terrainY: number;
  /** Non-increasing downstream water level (bank-clamped). */
  level: number;
  halfWidth: number;
}

interface TracedChannel {
  points: ChannelVertex[];
  id: number;
  /** AABB (inflated by max half-width) for cheap sample rejection. */
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/**
 * Per-sampler memo of traced channels. Keyed by the sampler (WeakMap) so tests with
 * different terrain functions never share entries; content is a pure function of
 * (basin coords, sampler), so eviction + rebuild is bit-identical.
 */
const channelMemos = new WeakMap<TerrainHeightSampler, Map<number, TracedChannel | null>>();

function channelMemoFor(sampler: TerrainHeightSampler): Map<number, TracedChannel | null> {
  let memo = channelMemos.get(sampler);
  if (!memo) {
    memo = new Map();
    channelMemos.set(sampler, memo);
  }
  return memo;
}

/** True when a trace point sits under the spill level of a containing basin — the
 *  channel has drained into standing water. Pure terrain/basin lookup, no channel
 *  recursion: basins never depend on channels. */
function channelReachedBasin(x: number, z: number, terrainY: number, sampler: TerrainHeightSampler): boolean {
  for (const hit of collectBasinHits(x, z, sampler)) {
    if (hit.basin.waterY > terrainY) return true;
  }
  return false;
}

/**
 * Trace one drainage channel for a basin: start at a hashed seed, follow the terrain
 * gradient downhill with inertia, stop when it drains into a basin, on flat ground, or
 * at the step budget. Returns null when the basin does not spawn a channel or the trace
 * is too short to be a river.
 */
function traceChannel(basinX: number, basinZ: number, sampler: TerrainHeightSampler): TracedChannel | null {
  if (hash2(basinX, basinZ, 101) > RIVER_SPAWN_THRESHOLD) return null;
  let px = basinCenter(basinX, hash2(basinX, basinZ, 107));
  let pz = basinCenter(basinZ, hash2(basinX, basinZ, 109));
  let dirX = 0;
  let dirZ = 0;
  const xs: number[] = [];
  const zs: number[] = [];
  const heights: number[] = [];
  for (let i = 0; i < RIVER_TRACE_STEPS; i++) {
    const y = sampler.surfaceHeight(px, pz);
    // Central-difference gradient; descent direction is -gradient.
    const gx = (sampler.surfaceHeight(px + RIVER_GRAD_STEP_M, pz) - sampler.surfaceHeight(px - RIVER_GRAD_STEP_M, pz)) / (2 * RIVER_GRAD_STEP_M);
    const gz = (sampler.surfaceHeight(px, pz + RIVER_GRAD_STEP_M) - sampler.surfaceHeight(px, pz - RIVER_GRAD_STEP_M)) / (2 * RIVER_GRAD_STEP_M);
    const slope = Math.hypot(gx, gz);
    xs.push(px);
    zs.push(pz);
    heights.push(y);
    // Terminate into standing water: once the trace point sits under a basin's spill
    // level the channel has reached a lake/pond, so the polyline ends inside it and the
    // carve connects the channel bed through the shore instead of stopping short of it.
    if (i > 0 && channelReachedBasin(px, pz, y, sampler)) break;
    if (slope < RIVER_FLAT_SLOPE_STOP) break; // reached a flat / basin floor
    const stepX = -gx / slope;
    const stepZ = -gz / slope;
    const blendX = dirX * RIVER_TRACE_INERTIA + stepX * (1 - RIVER_TRACE_INERTIA);
    const blendZ = dirZ * RIVER_TRACE_INERTIA + stepZ * (1 - RIVER_TRACE_INERTIA);
    const blendLen = Math.hypot(blendX, blendZ) || 1;
    dirX = blendX / blendLen;
    dirZ = blendZ / blendLen;
    px += dirX * RIVER_TRACE_STEP_M;
    pz += dirZ * RIVER_TRACE_STEP_M;
  }
  const count = xs.length;
  if (count < RIVER_MIN_TRACE_POINTS) return null;

  const points: ChannelVertex[] = new Array(count);
  let minX = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let level = heights[0] + RIVER_LEVEL_OFFSET_M;
  let maxHalfWidth = 0;
  for (let i = 0; i < count; i++) {
    // Width grows with absolute downstream distance as an accumulation proxy.
    const halfWidth = mix(RIVER_WIDTH_MIN_M, RIVER_WIDTH_MAX_M, Math.min(1, (i * RIVER_TRACE_STEP_M) / RIVER_WIDTH_RAMP_M));
    // Non-increasing downstream profile: water never flows uphill along the channel.
    level = Math.min(level, heights[i] + RIVER_LEVEL_OFFSET_M);
    // Bank containment on cross-slopes: the surface may not sit above the channel's low
    // bank plus the offset, or water would overhang the falling side.
    const nextI = Math.min(count - 1, i + 1);
    const prevI = Math.max(0, i - 1);
    let segX = xs[nextI] - xs[prevI];
    let segZ = zs[nextI] - zs[prevI];
    const segLen = Math.hypot(segX, segZ) || 1;
    segX /= segLen;
    segZ /= segLen;
    const bankA = sampler.surfaceHeight(xs[i] - segZ * halfWidth, zs[i] + segX * halfWidth);
    const bankB = sampler.surfaceHeight(xs[i] + segZ * halfWidth, zs[i] - segX * halfWidth);
    level = Math.min(level, Math.min(bankA, bankB) + RIVER_LEVEL_OFFSET_M);
    points[i] = { x: xs[i], z: zs[i], terrainY: heights[i], level, halfWidth };
    maxHalfWidth = Math.max(maxHalfWidth, halfWidth);
    minX = Math.min(minX, xs[i]);
    minZ = Math.min(minZ, zs[i]);
    maxX = Math.max(maxX, xs[i]);
    maxZ = Math.max(maxZ, zs[i]);
  }
  return {
    points,
    id: basinBodyId(basinX, basinZ, 103),
    minX: minX - maxHalfWidth,
    minZ: minZ - maxHalfWidth,
    maxX: maxX + maxHalfWidth,
    maxZ: maxZ + maxHalfWidth,
  };
}

function getChannel(basinX: number, basinZ: number, sampler: TerrainHeightSampler): TracedChannel | null {
  const memo = channelMemoFor(sampler);
  const key = basinKey(basinX, basinZ);
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  const traced = traceChannel(basinX, basinZ, sampler);
  if (memo.size >= CHANNEL_MEMO_MAX) {
    const oldest = memo.keys().next().value as number;
    memo.delete(oldest);
  }
  memo.set(key, traced);
  return traced;
}

/** Per-sampler memo of the channel search neighbourhood (5×5 basins) around a centre
 *  basin cell, in the same oz-outer/ox-inner order the direct loop used. */
const channelHoodMemos = new WeakMap<TerrainHeightSampler, Map<number, TracedChannel[]>>();

function getChannelHood(bx: number, bz: number, sampler: TerrainHeightSampler): TracedChannel[] {
  let memo = channelHoodMemos.get(sampler);
  if (!memo) {
    memo = new Map();
    channelHoodMemos.set(sampler, memo);
  }
  const key = basinKey(bx, bz);
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  const hood: TracedChannel[] = [];
  for (let oz = -RIVER_SEARCH_RADIUS_BASINS; oz <= RIVER_SEARCH_RADIUS_BASINS; oz++) {
    for (let ox = -RIVER_SEARCH_RADIUS_BASINS; ox <= RIVER_SEARCH_RADIUS_BASINS; ox++) {
      const channel = getChannel(bx + ox, bz + oz, sampler);
      if (channel) hood.push(channel);
    }
  }
  if (memo.size >= CHANNEL_MEMO_MAX) {
    const oldest = memo.keys().next().value as number;
    memo.delete(oldest);
  }
  memo.set(key, hood);
  return hood;
}

interface ChannelHit {
  level: number;
  halfWidth: number;
  distance: number;
  flowX: number;
  flowZ: number;
  drop: number;
  id: number;
}

/** Nearest in-channel hit across a channel's segments, or null when outside its width.
 *  `halfWidthFloorM` inflates the effective half-width for coarse-LOD consumers (the
 *  far-summary imprint) so a channel narrower than a summary cell still registers;
 *  water sampling always passes 0 and sees the exact traced widths. */
function channelHitAt(channel: TracedChannel, x: number, z: number, halfWidthFloorM = 0): ChannelHit | null {
  if (
    x < channel.minX - halfWidthFloorM || x > channel.maxX + halfWidthFloorM
    || z < channel.minZ - halfWidthFloorM || z > channel.maxZ + halfWidthFloorM
  ) return null;
  const pts = channel.points;
  let best: ChannelHit | null = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const abX = b.x - a.x;
    const abZ = b.z - a.z;
    const abLen2 = abX * abX + abZ * abZ;
    if (abLen2 <= 0) continue;
    const t = clamp01(((x - a.x) * abX + (z - a.z) * abZ) / abLen2);
    const cx = a.x + abX * t;
    const cz = a.z + abZ * t;
    const distance = Math.hypot(x - cx, z - cz);
    const halfWidth = Math.max(mix(a.halfWidth, b.halfWidth, t), halfWidthFloorM);
    if (distance > halfWidth) continue;
    if (best && distance >= best.distance) continue;
    const abLen = Math.sqrt(abLen2);
    best = {
      level: mix(a.level, b.level, t),
      halfWidth,
      distance,
      flowX: abX / abLen,
      flowZ: abZ / abLen,
      drop: Math.max(0, a.level - b.level),
      id: channel.id,
    };
  }
  return best;
}

/** All channel hits at (x, z) across the search neighbourhood. */
function collectChannelHits(x: number, z: number, sampler: TerrainHeightSampler, halfWidthFloorM = 0): ChannelHit[] {
  const hood = getChannelHood(basinCoord(x), basinCoord(z), sampler);
  const hits: ChannelHit[] = [];
  for (const channel of hood) {
    const hit = channelHitAt(channel, x, z, halfWidthFloorM);
    if (hit) hits.push(hit);
  }
  return hits;
}

// Channel carve profile: full carve depth inside the wet core (the riverMask=1 zone,
// distance <= 0.7*halfWidth), fading to zero exactly at the channel edge so banks join
// the untouched field with no cliff. Inside the core the bed is pinned below the
// (bank-clamped, monotonic) channel level, which is what guarantees a continuous
// water-holding channel on slopes — the old pothole failure mode.
const CARVE_EDGE_FADE_END = 0.3;

function carveChannelBed(baseHeight: number, hits: readonly ChannelHit[], config: InfiniteHydrologyCarveConfig): number {
  let carved = baseHeight;
  for (const hit of hits) {
    const w = 1 - hit.distance / Math.max(1e-6, hit.halfWidth);
    const edge = smoothstep(0, CARVE_EDGE_FADE_END, w);
    if (edge <= 0) continue;
    const shape = Math.pow(Math.max(0, w), Math.max(0.1, config.power));
    const depth = Math.max(0.05, config.depthM) * (0.35 + 0.65 * shape);
    const target = Math.min(baseHeight, hit.level - depth);
    carved = Math.min(carved, baseHeight + (target - baseHeight) * edge);
  }
  return carved;
}

function carveLakeBed(baseHeight: number, basins: readonly BasinHit[], config: InfiniteHydrologyCarveConfig): number {
  let carved = baseHeight;
  for (const hit of basins) {
    if (hit.mask <= 0) continue;
    const target = Math.min(baseHeight, hit.basin.waterY - Math.max(0.05, config.lakeBedDepthM));
    carved = Math.min(carved, baseHeight + (target - baseHeight) * hit.mask);
  }
  return carved;
}

/**
 * Terrain carve for the traced/infinite hydrology field — the streamed-world analogue
 * of the graph sampler's carveHeight. Pure function of (x, z, base sampler, config);
 * channels/basins are traced against the *base* field only, so applying the carve to
 * the terrain authority never feeds back into the trace.
 *
 * `halfWidthFloorM` (optional) inflates the channel carve footprint for coarse-LOD
 * consumers whose cell size exceeds the traced width — without it a 10–28 m channel
 * point-sampled at far-summary resolution degenerates back into a pothole chain.
 * Terrain authorities must pass 0 (the default) so near geometry keeps exact widths.
 */
export function carveInfiniteHydrologyHeight(
  x: number,
  z: number,
  baseHeight: number,
  sampler: TerrainHeightSampler,
  config: InfiniteHydrologyCarveConfig,
  halfWidthFloorM = 0,
): number {
  const channelCarved = carveChannelBed(baseHeight, collectChannelHits(x, z, sampler, halfWidthFloorM), config);
  const lakeCarved = carveLakeBed(baseHeight, collectBasinHits(x, z, sampler), config);
  return Math.min(channelCarved, lakeCarved);
}

/** Carver with the GraphHydrologySampler.carveHeight shape, for the terrain seams
 *  (worker override, heightfield tiles) that already accept a hydrology carver. */
export function createTracedHydrologyCarver(
  sampler: TerrainHeightSampler,
): { carveHeight(x: number, z: number, baseHeight: number, config: InfiniteHydrologyCarveConfig): number } {
  return {
    carveHeight: (x, z, baseHeight, config) => carveInfiniteHydrologyHeight(x, z, baseHeight, sampler, config),
  };
}

export interface TracedRiverContinuity {
  /** Traced channels found inside the probe radius. */
  channels: number;
  /** Channel polyline vertices probed. */
  points: number;
  /** Vertices whose carved bed sits at least minVisibleDepthM under the channel level. */
  okPoints: number;
  /** 100 * okPoints / points; 100 when no channels exist (nothing to violate). */
  pct: number;
}

/**
 * W1 continuity gate: along every traced channel polyline in the probe radius, the
 * carved bed must sit at least minVisibleDepthM below the channel level — the invariant
 * that separates a continuous river from a pothole chain. Pure and cheap (channels are
 * memoized); intended for a one-shot startup probe, not per-frame use.
 */
/** Probe depth floor for the continuity gate. Must exceed RIVER_LEVEL_OFFSET_M: an
 *  uncarved bed already sits ~1.25 m under the level at centerline vertices, so a
 *  smaller floor would report 100% even with the carve disabled. */
export const RIVER_CONTINUITY_MIN_PROBE_DEPTH_M = 1.5;

export function measureTracedRiverContinuity(
  centerX: number,
  centerZ: number,
  radiusM: number,
  sampler: TerrainHeightSampler,
  carve: InfiniteHydrologyCarveConfig,
  minVisibleDepthM: number,
): TracedRiverContinuity {
  const probeDepthM = Math.max(minVisibleDepthM, RIVER_CONTINUITY_MIN_PROBE_DEPTH_M);
  const basinRadius = Math.max(1, Math.ceil(radiusM / BASIN_SIZE_M));
  const bx = basinCoord(centerX);
  const bz = basinCoord(centerZ);
  let channels = 0;
  let points = 0;
  let okPoints = 0;
  for (let oz = -basinRadius; oz <= basinRadius; oz++) {
    for (let ox = -basinRadius; ox <= basinRadius; ox++) {
      const channel = getChannel(bx + ox, bz + oz, sampler);
      if (!channel) continue;
      channels++;
      for (const point of channel.points) {
        points++;
        const bed = carveInfiniteHydrologyHeight(
          point.x,
          point.z,
          sampler.surfaceHeight(point.x, point.z),
          sampler,
          carve,
        );
        if (bed <= point.level - probeDepthM) okPoints++;
      }
    }
  }
  return { channels, points, okPoints, pct: points > 0 ? (100 * okPoints) / points : 100 };
}

function riverCandidate(terrainY: number, hits: readonly ChannelHit[]): HydrologySample | null {
  let best: ChannelHit | null = null;
  let bestDepth = 0;
  for (const hit of hits) {
    const depth = hit.level - terrainY;
    // Where independent channels overlap (a natural confluence), the deeper one owns
    // the sample so the surface has one well-defined height.
    if (depth > bestDepth) {
      bestDepth = depth;
      best = hit;
    }
  }
  // Wet only where terrain sits below the (bank-clamped, monotonic) channel level.
  if (!best || bestDepth <= 0) return null;
  const riverMask = 1 - smoothstep(best.halfWidth * 0.7, best.halfWidth, best.distance);
  if (riverMask <= 0) return null;
  const waterY = best.level;
  const depth = bestDepth;
  const speed = Math.max(0.08, best.drop * 0.35 + 0.18) * riverMask;
  return {
    terrainY,
    waterY,
    depth,
    bodyMask: riverMask,
    lakeMask: 0,
    riverMask,
    flowX: best.flowX,
    flowZ: best.flowZ,
    flowStrength: speed,
    riverDepth: depth,
    waterYFar: waterY,
    moisture: Math.max(0.32, riverMask),
    bodyKind: HYDROLOGY_BODY_RIVER,
    bodyId: best.id,
    shoreDistance: Math.max(0, best.halfWidth - best.distance),
  };
}

export function sampleInfiniteHydrology(
  x: number,
  z: number,
  sampler: TerrainHeightSampler,
  options: InfiniteHydrologyOptions = {},
): HydrologySample {
  const dryDepthM = Math.max(1, options.drySentinelDepthM ?? DRY_DEPTH_M);
  const carve = options.carve ?? null;
  const baseY = sampler.surfaceHeight(x, z);
  const channelHits = collectChannelHits(x, z, sampler);
  const basinHits = collectBasinHits(x, z, sampler);
  const terrainY = carve
    ? Math.min(carveChannelBed(baseY, channelHits, carve), carveLakeBed(baseY, basinHits, carve))
    : baseY;
  const river = riverCandidate(terrainY, channelHits);
  const lake = lakeCandidate(terrainY, basinHits);
  if (river && lake) return river.bodyMask >= lake.bodyMask ? river : lake;
  if (river) return river;
  if (lake) return lake;
  return drySample(terrainY, dryDepthM);
}
