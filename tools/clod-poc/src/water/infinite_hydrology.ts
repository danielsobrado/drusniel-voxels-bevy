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
const RIVER_TRACE_STEPS = 48;
const RIVER_TRACE_STEP_M = 24;
const RIVER_GRAD_STEP_M = 12;
const RIVER_MIN_TRACE_POINTS = 6;
/** Stop tracing when the local slope falls below this (m per m): reached a flat/basin. */
const RIVER_FLAT_SLOPE_STOP = 0.005;
const RIVER_TRACE_INERTIA = 0.55;
/**
 * Channel search radius in basins. Must satisfy: max seed-to-sample distance a channel
 * can bridge (trace length + half-width ≈ 1.2 km) < (radius - 0.5+) * BASIN_SIZE_M, so a
 * sample near a channel tail still finds the seed basin (radius 2 -> 1536 m guaranteed).
 */
const RIVER_SEARCH_RADIUS_BASINS = 2;
/** Bounded memo of traced channels; rebuilt entries are bit-identical (pure function). */
const CHANNEL_MEMO_MAX = 512;

export interface InfiniteHydrologyOptions {
  drySentinelDepthM?: number;
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

function lakeCandidate(x: number, z: number, sampler: TerrainHeightSampler): HydrologySample | null {
  const bx = basinCoord(x);
  const bz = basinCoord(z);
  let best: { mask: number; waterY: number; lakeMask: number; kind: number; radius: number; distance: number; id: number } | null = null;
  for (let oz = -1; oz <= 1; oz++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = bx + ox;
      const cz = bz + oz;
      const spawn = hash2(cx, cz, 11);
      if (spawn > 0.55) continue;
      let centerX = basinCenter(cx, hash2(cx, cz, 17));
      let centerZ = basinCenter(cz, hash2(cx, cz, 23));
      const radius = mix(LAKE_RADIUS_MIN_M, LAKE_RADIUS_MAX_M, hash2(cx, cz, 31));
      // The refined centre below moves at most 2 descent steps; skip basins whose disc
      // cannot reach this sample even after that move (keeps per-sample terrain lookups
      // bounded away from basin centres).
      const reach = radius + LAKE_DESCENT_STEP_M * 2;
      if (Math.hypot(x - centerX, z - centerZ) > reach) continue;
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
      const dx = x - centerX;
      const dz = z - centerZ;
      const distance = Math.hypot(dx, dz);
      // Hard containment at the rim radius: no fade band outside it, otherwise terrain
      // that falls away past the rim would carry floating water. Shoreline softness comes
      // from the depth->0 crossing inside the basin, not from the radial mask.
      if (distance > radius) continue;
      const mask = 1 - smoothstep(radius * 0.82, radius, distance);
      if (mask <= (best?.mask ?? 0)) continue;
      const waterY = lakeSpillLevel(centerX, centerZ, radius, sampler);
      if (waterY === null) continue; // invalid basin: reject the lake rather than forcing it
      best = {
        mask,
        waterY,
        lakeMask: spawn < 0.15 ? mask : 0,
        kind: spawn < 0.15 ? HYDROLOGY_BODY_LAKE : HYDROLOGY_BODY_POND,
        radius,
        distance,
        id: basinBodyId(cx, cz, 41),
      };
    }
  }
  if (!best) return null;
  const terrainY = sampler.surfaceHeight(x, z);
  const wet = best.waterY > terrainY;
  if (!wet) return null; // basin water surface is below local terrain here: dry ground, not floating water.
  const waterY = best.waterY;
  const bodyMask = best.mask;
  return {
    terrainY,
    waterY,
    depth: waterY - terrainY,
    bodyMask,
    lakeMask: best.lakeMask,
    riverMask: 0,
    flowX: 0,
    flowZ: 0,
    flowStrength: 0,
    riverDepth: 0,
    waterYFar: waterY,
    moisture: Math.max(0.24, bodyMask),
    bodyKind: best.kind,
    bodyId: best.id,
    shoreDistance: Math.max(0, best.radius - best.distance),
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
const channelMemos = new WeakMap<TerrainHeightSampler, Map<string, TracedChannel | null>>();

function channelMemoFor(sampler: TerrainHeightSampler): Map<string, TracedChannel | null> {
  let memo = channelMemos.get(sampler);
  if (!memo) {
    memo = new Map();
    channelMemos.set(sampler, memo);
  }
  return memo;
}

/**
 * Trace one drainage channel for a basin: start at a hashed seed, follow the terrain
 * gradient downhill with inertia, stop on flat ground or step budget. Returns null when
 * the basin does not spawn a channel or the trace is too short to be a river.
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
    // Width grows downstream as an accumulation proxy.
    const halfWidth = mix(RIVER_WIDTH_MIN_M, RIVER_WIDTH_MAX_M, i / Math.max(1, count - 1));
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
  const key = `${basinX},${basinZ}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  const traced = traceChannel(basinX, basinZ, sampler);
  if (memo.size >= CHANNEL_MEMO_MAX) {
    const oldest = memo.keys().next().value as string;
    memo.delete(oldest);
  }
  memo.set(key, traced);
  return traced;
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

/** Nearest in-channel hit across a channel's segments, or null when outside its width. */
function channelHitAt(channel: TracedChannel, x: number, z: number): ChannelHit | null {
  if (x < channel.minX || x > channel.maxX || z < channel.minZ || z > channel.maxZ) return null;
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
    const halfWidth = mix(a.halfWidth, b.halfWidth, t);
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

function riverCandidate(x: number, z: number, sampler: TerrainHeightSampler): HydrologySample | null {
  const bx = basinCoord(x);
  const bz = basinCoord(z);
  let best: ChannelHit | null = null;
  let bestDepth = 0;
  const terrainY = sampler.surfaceHeight(x, z);
  for (let oz = -RIVER_SEARCH_RADIUS_BASINS; oz <= RIVER_SEARCH_RADIUS_BASINS; oz++) {
    for (let ox = -RIVER_SEARCH_RADIUS_BASINS; ox <= RIVER_SEARCH_RADIUS_BASINS; ox++) {
      const channel = getChannel(bx + ox, bz + oz, sampler);
      if (!channel) continue;
      const hit = channelHitAt(channel, x, z);
      if (!hit) continue;
      const depth = hit.level - terrainY;
      // Where independent channels overlap (a natural confluence), the deeper one owns
      // the sample so the surface has one well-defined height.
      if (depth > bestDepth) {
        bestDepth = depth;
        best = hit;
      }
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
  const river = riverCandidate(x, z, sampler);
  const lake = lakeCandidate(x, z, sampler);
  if (river && lake) return river.bodyMask >= lake.bodyMask ? river : lake;
  if (river) return river;
  if (lake) return lake;
  return drySample(sampler.surfaceHeight(x, z), dryDepthM);
}
