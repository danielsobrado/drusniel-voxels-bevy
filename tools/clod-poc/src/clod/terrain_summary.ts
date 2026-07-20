import * as THREE from "three";
import type { ClodPageNode } from "../types.js";
import { surfaceHeightCore } from "../gpu/terrain_field_core.js";
import type { WorldSource } from "../world_source/world_source.js";
export type { TerrainSummaryField, TerrainSummaryBuildOptions } from "./terrain_summary_types.js";
import type { TerrainSummaryField, TerrainSummaryBuildOptions } from "./terrain_summary_types.js";
import {
  gridIndex, cellCenter, defaultBiomeSampler, outsideSummaryFootprint,
  sampleAnalyticNormal, clamp01, canopyBiomeGate, extendedRes,
  hash, fbm, smooth01,
} from "./terrain_summary_helpers.js";

export function populateTerrainSummaryBiomes(field: TerrainSummaryField, worldSource: Pick<WorldSource, "sampleHeight" | "sampleBiome">): TerrainSummaryField {
  const biomeId = new Uint8Array(field.res * field.res);
  for (let fz = 0; fz < field.res; fz++) {
    for (let fx = 0; fx < field.res; fx++) {
      const [wx, wz] = cellCenter(field.res, field.worldSize, fx, fz);
      biomeId[gridIndex(field.res, fx, fz)] = worldSource.sampleBiome(wx, wz);
    }
  }
  field.biomeId = biomeId;
  field.analyticHeightSampler = (x, z) => worldSource.sampleHeight(x, z);
  field.analyticBiomeSampler = (x, z) => worldSource.sampleBiome(x, z);
  return field;
}

export function buildTerrainSummary(allNodes: readonly ClodPageNode[], worldSize: number, farReduceFactor: number, options: TerrainSummaryBuildOptions = {}): TerrainSummaryField {
  const reduce = Math.max(1, Math.floor(farReduceFactor));
  const pageRes = Math.max(1, Math.floor(worldSize));
  const res = Math.max(1, Math.floor(pageRes / reduce));
  const summaryRes = res;
  const heightMin = new Float32Array(summaryRes * summaryRes).fill(Number.POSITIVE_INFINITY);
  const heightMax = new Float32Array(summaryRes * summaryRes).fill(Number.NEGATIVE_INFINITY);
  const normalX = new Float32Array(summaryRes * summaryRes).fill(0);
  const normalY = new Float32Array(summaryRes * summaryRes).fill(0);
  const normalZ = new Float32Array(summaryRes * summaryRes).fill(0);
  const coverage = new Float32Array(summaryRes * summaryRes).fill(0);
  const biomeId = new Uint8Array(summaryRes * summaryRes);
  const analyticHeight = options.worldSource
    ? (x: number, z: number) => options.worldSource!.sampleHeight(x, z)
    : (x: number, z: number) => surfaceHeightCore(x, z);
  const analyticBiome = options.worldSource
    ? (x: number, z: number, _height: number) => options.worldSource!.sampleBiome(x, z)
    : defaultBiomeSampler();
  const cellSize = worldSize / summaryRes;
  for (const node of allNodes) {
    const f = node.footprint;
    const fx0 = Math.floor((f.minX / worldSize) * summaryRes);
    const fz0 = Math.floor((f.minZ / worldSize) * summaryRes);
    const fx1 = Math.ceil((f.maxX / worldSize) * summaryRes);
    const fz1 = Math.ceil((f.maxZ / worldSize) * summaryRes);
    for (let fz = Math.max(0, fz0); fz < Math.min(summaryRes, fz1); fz++) {
      for (let fx = Math.max(0, fx0); fx < Math.min(summaryRes, fx1); fx++) {
        const idx = gridIndex(summaryRes, fx, fz);
        heightMin[idx] = Math.min(heightMin[idx], node.bounds.minY);
        heightMax[idx] = Math.max(heightMax[idx], node.bounds.maxY);
        coverage[idx] = Math.min(1, coverage[idx] + 1);
      }
    }
  }
  for (let fz = 0; fz < summaryRes; fz++) {
    for (let fx = 0; fx < summaryRes; fx++) {
      const idx = gridIndex(summaryRes, fx, fz);
      const [wx, wz] = cellCenter(summaryRes, worldSize, fx, fz);
      if (!Number.isFinite(heightMin[idx])) {
        const y = analyticHeight(wx, wz);
        heightMin[idx] = y;
        heightMax[idx] = y;
      }
      biomeId[idx] = analyticBiome(wx, wz, heightMax[idx]);
    }
  }
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
  return { res: summaryRes, worldSize, farReduceFactor: reduce, heightMin, heightMax, normalX, normalY, normalZ, coverage, biomeId, analyticHeightSampler: analyticHeight, analyticBiomeSampler: (x, z) => analyticBiome(x, z, analyticHeight(x, z)) };
}

export function sampleHeight(field: TerrainSummaryField, x: number, z: number): number {
  if (outsideSummaryFootprint(field, x, z) && field.analyticHeightSampler) return field.analyticHeightSampler(x, z);
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
  return h(ix, iz) * (1 - tx) * (1 - tz) + h(ix + 1, iz) * tx * (1 - tz) + h(ix, iz + 1) * (1 - tx) * tz + h(ix + 1, iz + 1) * tx * tz;
}

export function sampleHeightBlend(field: TerrainSummaryField, x: number, z: number, bias: number): number {
  if (outsideSummaryFootprint(field, x, z) && field.analyticHeightSampler) return field.analyticHeightSampler(x, z);
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
  return h(ix, iz) * (1 - tx) * (1 - tz) + h(ix + 1, iz) * tx * (1 - tz) + h(ix, iz + 1) * (1 - tx) * tz + h(ix + 1, iz + 1) * tx * tz;
}

export function sampleNormal(field: TerrainSummaryField, x: number, z: number): [number, number, number] {
  if (outsideSummaryFootprint(field, x, z)) {
    const analyticNormal = sampleAnalyticNormal(field, x, z);
    if (analyticNormal) return analyticNormal;
  }
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
  return [n(ix, iz, 0) * (1 - tx) * (1 - tz) + n(ix + 1, iz, 0) * tx * (1 - tz) + n(ix, iz + 1, 0) * (1 - tx) * tz + n(ix + 1, iz + 1, 0) * tx * tz, n(ix, iz, 1) * (1 - tx) * (1 - tz) + n(ix + 1, iz, 1) * tx * (1 - tz) + n(ix, iz + 1, 1) * (1 - tx) * tz + n(ix + 1, iz + 1, 1) * tx * tz, n(ix, iz, 2) * (1 - tx) * (1 - tz) + n(ix + 1, iz, 2) * tx * (1 - tz) + n(ix, iz + 1, 2) * (1 - tx) * tz + n(ix + 1, iz + 1, 2) * tx * tz];
}

export function sampleCoverage(field: TerrainSummaryField, x: number, z: number): number {
  if (outsideSummaryFootprint(field, x, z)) return 0;
  const fx = (x / field.worldSize) * field.res - 0.5;
  const fz = (z / field.worldSize) * field.res - 0.5;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const c = (lx: number, lz: number) => { const cx = Math.min(field.res - 1, Math.max(0, lx)); const cz = Math.min(field.res - 1, Math.max(0, lz)); return field.coverage[gridIndex(field.res, cx, cz)]; };
  return c(ix, iz) * (1 - tx) * (1 - tz) + c(ix + 1, iz) * tx * (1 - tz) + c(ix, iz + 1) * (1 - tx) * tz + c(ix + 1, iz + 1) * tx * tz;
}

export function sampleBiomeId(field: TerrainSummaryField, x: number, z: number): number {
  if (!field.biomeId) return field.analyticBiomeSampler?.(x, z) ?? 0;
  if (outsideSummaryFootprint(field, x, z) && field.analyticBiomeSampler) return field.analyticBiomeSampler(x, z);
  const fx = (x / field.worldSize) * field.res - 0.5;
  const fz = (z / field.worldSize) * field.res - 0.5;
  const ix = Math.min(field.res - 1, Math.max(0, Math.round(fx)));
  const iz = Math.min(field.res - 1, Math.max(0, Math.round(fz)));
  return field.biomeId[gridIndex(field.res, ix, iz)] ?? 0;
}

export function createHeightTexture(field: TerrainSummaryField): THREE.DataTexture {
  const { res, heightMax } = field;
  const data = new Float32Array(res * res);
  for (let i = 0; i < res * res; i++) data[i] = heightMax[i];
  return createDataTexture(data, res, res);
}

export function summaryBaseLevel(field: TerrainSummaryField): number {
  let base = Number.POSITIVE_INFINITY;
  for (let i = 0; i < field.heightMin.length; i++) {
    const v = field.heightMin[i];
    if (Number.isFinite(v)) base = Math.min(base, v);
  }
  return Number.isFinite(base) ? base : 0;
}

export function sampleSkirtHeight(field: TerrainSummaryField, x: number, z: number, farRadius: number, baseLevel: number, bias: number): number {
  const worldSize = field.worldSize;
  const edgeX = Math.max(0, Math.min(worldSize, x));
  const edgeZ = Math.max(0, Math.min(worldSize, z));
  const baked = sampleHeightBlend(field, edgeX, edgeZ, bias);
  const analytic = field.analyticHeightSampler?.(x, z) ?? surfaceHeightCore(x, z);
  const inner = Math.min(Math.min(x, worldSize - x), Math.min(z, worldSize - z));
  const edgeBand = worldSize * 0.1;
  const outside = Math.max(0, -inner);
  const edgeT = clamp01(outside / edgeBand);
  const blend = edgeT * edgeT * (3 - 2 * edgeT);
  let h = baked + (analytic - baked) * blend;
  const farFactor = clamp01(outside / (farRadius * 0.9));
  h += (baseLevel - h) * farFactor * 0.6;
  return h;
}

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
  return createDataTexture(data, res, res, true);
}

export function createExtendedCanopyTexture(field: TerrainSummaryField, farRadius: number, seed = 42): THREE.DataTexture {
  const worldSize = field.worldSize;
  const center = worldSize / 2;
  const extent = 2 * farRadius;
  const origin = center - farRadius;
  const res = extendedRes(field, farRadius);
  const data = new Float32Array(res * res);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const wx = origin + ((i + 0.5) / res) * extent;
      const wz = origin + ((j + 0.5) / res) * extent;
      const sx = (wx / worldSize) * field.res;
      const sz = (wz / worldSize) * field.res;
      const region = (fbm(sx * 0.03, sz * 0.03) + 0.75) / 1.5;
      const forest = smooth01(0.45, 0.65, region);
      const detail = hash(sx * 0.07, sz * 0.07, seed) * 0.3 + fbm(sx * 0.02, sz * 0.02) * 0.2;
      const inside = wx >= 0 && wx <= worldSize && wz >= 0 && wz <= worldSize;
      const exists = inside ? sampleCoverage(field, wx, wz) : 1;
      const biomeGate = canopyBiomeGate(sampleBiomeId(field, wx, wz));
      let c = exists * forest * biomeGate * (0.7 + detail);
      const distFromCenter = Math.hypot(wx - center, wz - center);
      c *= 1 - smooth01(farRadius * 0.7, farRadius * 0.98, distFromCenter);
      data[j * res + i] = clamp01(c);
    }
  }
  return createDataTexture(data, res, res, true);
}

function createDataTexture(data: Float32Array, width: number, height: number, linear = false): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.FloatType);
  tex.needsUpdate = true;
  tex.magFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  tex.minFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}
