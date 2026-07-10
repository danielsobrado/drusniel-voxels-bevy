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
const LAKE_EDGE_FADE_M = 18;
const RIVER_WIDTH_MIN_M = 10;
const RIVER_WIDTH_MAX_M = 28;
const RIVER_EDGE_FADE_M = 12;
const RIVER_MEANDER_M = 58;
const RIVER_MEANDER_SCALE = 0.0055;
const RIVER_LEVEL_OFFSET_M = 1.25;
const LAKE_LEVEL_OFFSET_M = 0.85;
const POND_LEVEL_OFFSET_M = 0.45;
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

function lakeCandidate(x: number, z: number, sampler: TerrainHeightSampler): HydrologySample | null {
  const bx = basinCoord(x);
  const bz = basinCoord(z);
  let best: { mask: number; waterY: number; lakeMask: number; kind: number; radius: number; distance: number; id: number } | null = null;
  for (let oz = -1; oz <= 1; oz++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = bx + ox;
      const cz = bz + oz;
      const spawn = hash2(cx, cz, 11);
      if (spawn > 0.34) continue;
      const centerX = basinCenter(cx, hash2(cx, cz, 17));
      const centerZ = basinCenter(cz, hash2(cx, cz, 23));
      const radius = mix(LAKE_RADIUS_MIN_M, LAKE_RADIUS_MAX_M, hash2(cx, cz, 31));
      const dx = x - centerX;
      const dz = z - centerZ;
      const distance = Math.hypot(dx, dz);
      if (distance > radius + LAKE_EDGE_FADE_M) continue;
      const mask = 1 - smoothstep(radius, radius + LAKE_EDGE_FADE_M, distance);
      if (mask <= (best?.mask ?? 0)) continue;
      const levelOffset = spawn < 0.08 ? LAKE_LEVEL_OFFSET_M : POND_LEVEL_OFFSET_M;
      best = {
        mask,
        // Basin spill level = terrain at the basin centre plus a small offset. This is a
        // constant per body; the cell is only wet where terrain sits *below* it, so a lake
        // never climbs the surrounding hillside.
        waterY: sampler.surfaceHeight(centerX, centerZ) + levelOffset,
        lakeMask: spawn < 0.08 ? mask : 0,
        kind: spawn < 0.08 ? HYDROLOGY_BODY_LAKE : HYDROLOGY_BODY_POND,
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
  const distance = Math.abs(across - channelOffset - meander);
  const halfWidth = mix(RIVER_WIDTH_MIN_M, RIVER_WIDTH_MAX_M, hash2(basinX, basinZ, 113));
  if (distance > halfWidth + RIVER_EDGE_FADE_M) return null;
  const riverMask = 1 - smoothstep(halfWidth, halfWidth + RIVER_EDGE_FADE_M, distance);
  const terrainY = sampler.surfaceHeight(x, z);
  // Orient flow so it points downhill along the (hashed) channel axis: sample terrain a
  // step forward and backward and flip the axis if "forward" is uphill. Macro drainage
  // routing is deferred to the Phase 3 tile authority; this keeps flow terrain-consistent
  // rather than purely hash-driven.
  const aheadY = sampler.surfaceHeight(x + dirX * 36, z + dirZ * 36);
  const behindY = sampler.surfaceHeight(x - dirX * 36, z - dirZ * 36);
  if (behindY < aheadY) { dirX = -dirX; dirZ = -dirZ; }
  const downstreamY = Math.min(aheadY, behindY);
  // Channel surface sits an offset above the local low point; the cell is wet only where
  // terrain is below it, so the river stays in the valley instead of climbing hills.
  const waterY = downstreamY + RIVER_LEVEL_OFFSET_M;
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
