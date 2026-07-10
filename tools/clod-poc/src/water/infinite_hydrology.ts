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
const RIVER_MEANDER_M = 58;
const RIVER_MEANDER_SCALE = 0.0055;
const RIVER_LEVEL_OFFSET_M = 1.25;
const DRY_DEPTH_M = 16;
const HASH_UINT_SCALE = 1 / 0xffffffff;

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

function riverCandidate(x: number, z: number, sampler: TerrainHeightSampler): HydrologySample | null {
  const basinX = basinCoord(x);
  const basinZ = basinCoord(z);
  const angle = mix(-0.72, 0.72, hash2(basinX, basinZ, 101));
  let dirX = Math.cos(angle);
  let dirZ = Math.sin(angle);
  const normalX = -dirZ;
  const normalZ = dirX;
  const along = x * dirX + z * dirZ;
  const across = x * normalX + z * normalZ;
  const channelOffset = (hash2(basinX, basinZ, 107) - 0.5) * BASIN_SIZE_M * 0.72;
  const meander = Math.sin(along * RIVER_MEANDER_SCALE + hash2(basinX, basinZ, 109) * Math.PI * 2) * RIVER_MEANDER_M;
  const acrossTarget = channelOffset + meander;
  const distance = Math.abs(across - acrossTarget);
  const halfWidth = mix(RIVER_WIDTH_MIN_M, RIVER_WIDTH_MAX_M, hash2(basinX, basinZ, 113));
  // Hard containment at the channel half-width: no fade band outside it — on a
  // cross-slope, terrain past the low bank keeps falling and a fade band there would
  // carry floating water. Shoreline softness comes from the depth->0 crossing.
  if (distance > halfWidth) return null;
  const riverMask = 1 - smoothstep(halfWidth * 0.7, halfWidth, distance);
  const terrainY = sampler.surfaceHeight(x, z);
  // Orient flow so it points downhill along the (hashed) channel axis: sample terrain a
  // step forward and backward and flip the axis if "forward" is uphill. Macro drainage
  // routing is deferred to the Phase 3 tile authority; this keeps flow terrain-consistent
  // rather than purely hash-driven.
  const aheadY = sampler.surfaceHeight(x + dirX * 36, z + dirZ * 36);
  const behindY = sampler.surfaceHeight(x - dirX * 36, z - dirZ * 36);
  if (behindY < aheadY) { dirX = -dirX; dirZ = -dirZ; }
  const downstreamY = Math.min(aheadY, behindY);
  // Bank containment on cross-slopes: the surface may not sit above the channel's low
  // bank plus the channel offset, or the water would overhang the falling side. Sample
  // both banks at the channel centreline nearest this point.
  const centerShift = acrossTarget - across;
  const ccx = x + normalX * centerShift;
  const ccz = z + normalZ * centerShift;
  const bankA = sampler.surfaceHeight(ccx + normalX * halfWidth, ccz + normalZ * halfWidth);
  const bankB = sampler.surfaceHeight(ccx - normalX * halfWidth, ccz - normalZ * halfWidth);
  const lowBank = Math.min(bankA, bankB);
  // Channel surface sits an offset above the local low point; the cell is wet only where
  // terrain is below it, so the river stays in the valley instead of climbing hills.
  const waterY = Math.min(downstreamY, lowBank) + RIVER_LEVEL_OFFSET_M;
  if (waterY <= terrainY) return null;
  const depth = waterY - terrainY;
  const speed = Math.max(0.08, Math.abs(terrainY - downstreamY) * 0.25 + 0.18) * riverMask;
  return {
    terrainY,
    waterY,
    depth,
    bodyMask: riverMask,
    lakeMask: 0,
    riverMask,
    flowX: dirX,
    flowZ: dirZ,
    flowStrength: speed,
    riverDepth: depth,
    waterYFar: waterY,
    moisture: Math.max(0.32, riverMask),
    bodyKind: HYDROLOGY_BODY_RIVER,
    bodyId: basinBodyId(basinX, basinZ, 103),
    shoreDistance: Math.max(0, halfWidth - distance),
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
