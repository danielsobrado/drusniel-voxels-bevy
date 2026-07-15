import * as THREE from "three";
import type { ClodPageNode } from "../../types.js";
import type { FarSummaryTile } from "../../naadf/types.js";
import { materialColorForDebugId, classifyTerrainMaterial } from "../../terrainMaterial/terrainMaterialBands.js";
import type { TerrainMaterialInput } from "../../terrainMaterial/terrainMaterialTypes.js";
import { sampleActiveErosionMaterialChannels } from "../../world/erosion/integration.js";
import type { TerrainMaterialCacheConfig } from "./terrainMaterialCacheConfig.js";
import type { TerrainMaterialBakePayload } from "./terrainMaterialCacheTypes.js";
import { clamp01, createUint16Channel, createUint8Channel, createUnavailableChannel, estimatePayloadBytes, packUnorm8 } from "./terrainMaterialPacking.js";

export interface TerrainMaterialPageBakeSource {
  node: ClodPageNode;
  waterLevel: number;
  materialConfig: TerrainMaterialInput["config"];
}

export interface TerrainMaterialFarTileBakeSource {
  tile: FarSummaryTile;
  materialConfig?: TerrainMaterialInput["config"];
  distanceFromCamera?: number;
}

export function buildMacroTint(samples: readonly [number, number, number][], resolution: number): Uint8Array {
  const data = new Uint8Array(resolution * resolution * 4);
  for (let i = 0; i < resolution * resolution; i++) {
    const color = samples[i] ?? [1, 1, 1];
    const dst = i * 4;
    data[dst] = packUnorm8(color[0]);
    data[dst + 1] = packUnorm8(color[1]);
    data[dst + 2] = packUnorm8(color[2]);
    data[dst + 3] = 255;
  }
  return data;
}

export function buildSlopeCurvature(heights: Float32Array, resolution: number, cellM: number): Uint8Array {
  const data = new Uint8Array(resolution * resolution * 2);
  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      const idx = z * resolution + x;
      const h = heightAt(heights, resolution, x, z);
      const hL = heightAt(heights, resolution, x - 1, z);
      const hR = heightAt(heights, resolution, x + 1, z);
      const hD = heightAt(heights, resolution, x, z - 1);
      const hU = heightAt(heights, resolution, x, z + 1);
      const dhdx = (hR - hL) / Math.max(cellM * 2, 1e-6);
      const dhdz = (hU - hD) / Math.max(cellM * 2, 1e-6);
      const slope = clamp01(Math.hypot(dhdx, dhdz));
      const curvature = clamp01(Math.abs(hL + hR + hD + hU - 4 * h) / Math.max(cellM * 4, 1e-6));
      data[idx * 2] = packUnorm8(slope);
      data[idx * 2 + 1] = packUnorm8(curvature);
    }
  }
  return data;
}

export function buildMaterialWeights(weights: readonly [number, number, number, number][], resolution: number): Uint8Array {
  const data = new Uint8Array(resolution * resolution * 4);
  for (let i = 0; i < resolution * resolution; i++) {
    const w = weights[i] ?? [1, 0, 0, 0];
    const dst = i * 4;
    data[dst] = packUnorm8(w[0]);
    data[dst + 1] = packUnorm8(w[1]);
    data[dst + 2] = packUnorm8(w[2]);
    data[dst + 3] = packUnorm8(w[3]);
  }
  return data;
}

export function buildWetnessAndShoreline(
  heights: Float32Array,
  waterCoverage: Float32Array | null,
  resolution: number,
  waterLevel: number,
  erosionWetness?: Float32Array | null,
): Uint8Array {
  const data = new Uint8Array(resolution * resolution * 2);
  for (let i = 0; i < resolution * resolution; i++) {
    const h = heights[i] ?? 0;
    const baseWetness = waterCoverage ? waterCoverage[i] ?? 0 : clamp01(1 - Math.abs(h - waterLevel) / 8);
    const wetness = Math.max(baseWetness, erosionWetness?.[i] ?? 0);
    const shoreline = clamp01(1 - Math.abs(h - waterLevel) / 3);
    data[i * 2] = packUnorm8(wetness);
    data[i * 2 + 1] = packUnorm8(shoreline);
  }
  return data;
}

export function buildFarColor(tile: FarSummaryTile): Uint8Array {
  const count = tile.resolution * tile.resolution;
  const data = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    const color = materialColorForDebugId(tile.dominantMaterial[i] ?? 0);
    const dst = i * 4;
    data[dst] = packUnorm8(color[0]);
    data[dst + 1] = packUnorm8(color[1]);
    data[dst + 2] = packUnorm8(color[2]);
    data[dst + 3] = 255;
  }
  return data;
}

export function buildFarNormal(tile: FarSummaryTile): Uint16Array {
  const count = tile.resolution * tile.resolution;
  const data = new Uint16Array(count * 2);
  for (let z = 0; z < tile.resolution; z++) {
    for (let x = 0; x < tile.resolution; x++) {
      const idx = z * tile.resolution + x;
      const n = normalFromHeight(tile.avgHeight, tile.resolution, tile.cellM, x, z);
      data[idx * 2] = THREE.DataUtils.toHalfFloat(n.x);
      data[idx * 2 + 1] = THREE.DataUtils.toHalfFloat(n.z);
    }
  }
  return data;
}

export function buildCoverage(canopyCoverage: Float32Array, waterCoverage: Float32Array, resolution: number): Uint8Array {
  const data = new Uint8Array(resolution * resolution * 2);
  for (let i = 0; i < resolution * resolution; i++) {
    data[i * 2] = packUnorm8(canopyCoverage[i] ?? 0);
    data[i * 2 + 1] = packUnorm8(waterCoverage[i] ?? 0);
  }
  return data;
}

export function bakeFarSummaryTerrainMaterial(source: TerrainMaterialFarTileBakeSource, config: TerrainMaterialCacheConfig): TerrainMaterialBakePayload {
  const start = performance.now();
  const tile = source.tile;
  const useHeightDerivedNormal = config.sampling.deriveFarNormalFromHeightWhenPossible
    || (source.distanceFromCamera ?? Number.POSITIVE_INFINITY) >= config.sampling.normalStorageDistanceThreshold;
  const farColor = createUint8Channel(buildFarColor(tile), tile.resolution, tile.resolution, config.formats.farColor);
  const slopeCurvature = createUint8Channel(buildSlopeCurvature(tile.avgHeight, tile.resolution, tile.cellM), tile.resolution, tile.resolution, config.formats.slopeCurvature);
  const wetnessShoreline = createUint8Channel(buildWetnessAndShoreline(tile.avgHeight, tile.waterCoverage, tile.resolution, 0), tile.resolution, tile.resolution, config.formats.wetnessShoreline);
  const coverage = createUint8Channel(buildCoverage(tile.canopyCoverage, tile.waterCoverage, tile.resolution), tile.resolution, tile.resolution, config.formats.coverage);
  const farNormal = useHeightDerivedNormal
    ? createUnavailableChannel<Uint16Array>(config.formats.farNormal, tile.resolution, tile.resolution)
    : createUint16Channel(buildFarNormal(tile), tile.resolution, tile.resolution, config.formats.farNormal);
  const unavailableChannels = ["macroTint", "materialWeights"];
  if (useHeightDerivedNormal || !farNormal.available) unavailableChannels.push("farNormal");
  const payload: TerrainMaterialBakePayload = {
    slopeCurvature,
    wetnessShoreline,
    farColor,
    farNormal,
    coverage,
    debug: {
      unavailableChannels,
      sourceSampleCount: tile.resolution * tile.resolution,
      bakeMs: performance.now() - start,
      uploadMs: 0,
      usedHeightDerivedNormal: useHeightDerivedNormal,
    },
  };
  return withMeasuredBytes(payload);
}

export function bakePageTerrainMaterial(source: TerrainMaterialPageBakeSource, config: TerrainMaterialCacheConfig): TerrainMaterialBakePayload {
  const start = performance.now();
  const mesh = source.node.mesh;
  const resolution = config.sampling.pageResolution;
  const heights = rasterizePageHeights(source.node, resolution);
  const colors: [number, number, number][] = [];
  const weights: [number, number, number, number][] = [];
  const erosionWetness = new Float32Array(resolution * resolution);
  const pageWidth = Math.max(1, source.node.footprint.maxX - source.node.footprint.minX);
  const pageDepth = Math.max(1, source.node.footprint.maxZ - source.node.footprint.minZ);
  const cellM = Math.max(pageWidth, pageDepth) / resolution;

  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      const idx = z * resolution + x;
      const wx = source.node.footprint.minX + ((x + 0.5) / resolution) * pageWidth;
      const wz = source.node.footprint.minZ + ((z + 0.5) / resolution) * pageDepth;
      const slope = slopeAt(heights, resolution, cellM, x, z);
      const erosion = sampleActiveErosionMaterialChannels(wx, wz);
      erosionWetness[idx] = erosion?.wetnessSeed ?? 0;
      const sample = classifyTerrainMaterial({
        worldX: wx,
        worldZ: wz,
        height: heights[idx] ?? 0,
        slope,
        waterLevel: source.waterLevel,
        erosion,
        config: source.materialConfig,
      });
      colors.push(sample.baseColor);
      weights.push([
        sample.weights.sand,
        sample.weights.grass,
        sample.weights.dirt,
        sample.weights.rock,
      ]);
    }
  }

  const payload: TerrainMaterialBakePayload = {
    macroTint: createUint8Channel(buildMacroTint(colors, resolution), resolution, resolution, config.formats.macroTint),
    slopeCurvature: createUint8Channel(buildSlopeCurvature(heights, resolution, cellM), resolution, resolution, config.formats.slopeCurvature),
    materialWeights: createUint8Channel(buildMaterialWeights(weights, resolution), resolution, resolution, config.formats.materialWeights),
    wetnessShoreline: createUint8Channel(
      buildWetnessAndShoreline(heights, null, resolution, source.waterLevel, erosionWetness),
      resolution,
      resolution,
      config.formats.wetnessShoreline,
    ),
    farColor: createUnavailableChannel(config.formats.farColor, resolution, resolution),
    coverage: createUnavailableChannel(config.formats.coverage, resolution, resolution),
    debug: {
      unavailableChannels: ["farColor", "farNormal", "coverage"],
      sourceSampleCount: mesh.positions.length / 3,
      bakeMs: performance.now() - start,
      uploadMs: 0,
      usedHeightDerivedNormal: false,
    },
  };
  return withMeasuredBytes(payload);
}

function withMeasuredBytes(payload: TerrainMaterialBakePayload): TerrainMaterialBakePayload {
  estimatePayloadBytes(payload);
  return payload;
}

function heightAt(heights: Float32Array, resolution: number, x: number, z: number): number {
  const cx = Math.max(0, Math.min(resolution - 1, x));
  const cz = Math.max(0, Math.min(resolution - 1, z));
  return heights[cz * resolution + cx] ?? 0;
}

function normalFromHeight(heights: Float32Array, resolution: number, cellM: number, x: number, z: number): THREE.Vector3 {
  const hL = heightAt(heights, resolution, x - 1, z);
  const hR = heightAt(heights, resolution, x + 1, z);
  const hD = heightAt(heights, resolution, x, z - 1);
  const hU = heightAt(heights, resolution, x, z + 1);
  return new THREE.Vector3(
    (hL - hR) / Math.max(2 * cellM, 1e-6),
    1,
    (hD - hU) / Math.max(2 * cellM, 1e-6),
  ).normalize();
}

function slopeAt(heights: Float32Array, resolution: number, cellM: number, x: number, z: number): number {
  const n = normalFromHeight(heights, resolution, cellM, x, z);
  return clamp01(1 - Math.max(0, n.y));
}

function rasterizePageHeights(node: ClodPageNode, resolution: number): Float32Array {
  const heights = new Float32Array(resolution * resolution);
  const counts = new Uint16Array(resolution * resolution);
  const mesh = node.mesh;
  const width = Math.max(1e-6, node.footprint.maxX - node.footprint.minX);
  const depth = Math.max(1e-6, node.footprint.maxZ - node.footprint.minZ);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = Math.max(0, Math.min(resolution - 1, Math.floor(((mesh.positions[i]! - node.footprint.minX) / width) * resolution)));
    const z = Math.max(0, Math.min(resolution - 1, Math.floor(((mesh.positions[i + 2]! - node.footprint.minZ) / depth) * resolution)));
    const idx = z * resolution + x;
    heights[idx] += mesh.positions[i + 1] ?? 0;
    counts[idx]++;
  }
  let last = node.bounds.center[1];
  for (let i = 0; i < heights.length; i++) {
    if (counts[i]! > 0) {
      heights[i] /= counts[i]!;
      last = heights[i]!;
    } else {
      heights[i] = last;
    }
  }
  return heights;
}
