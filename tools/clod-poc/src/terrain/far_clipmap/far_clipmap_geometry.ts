import * as THREE from "three";
import type { FarHeightProviderSample } from "../../far-summary/clipmap-sampler.js";
import type { FarClipmapSource } from "./far_clipmap_source.js";

export interface FarClipmapGridGeometryOptions {
  gridResolution: number;
}

export interface FarClipmapBuildStats {
  vertices: number;
  triangles: number;
  fallbackSamples: number;
  exceptionSamples: number;
}

export interface FarClipmapTerrainGeometryOptions {
  gridResolution: number;
  centerX: number;
  centerZ: number;
  innerRadiusM: number;
  outerRadiusM: number;
  heightScale: number;
  yOffset: number;
  source: FarClipmapSource;
  stats?: FarClipmapBuildStats;
}

function safeGridResolution(value: number): number {
  if (!Number.isFinite(value)) return 2;
  return Math.max(2, Math.floor(value));
}

function recordFallback(stats: FarClipmapBuildStats | undefined): void {
  if (stats) stats.fallbackSamples++;
}

function recordException(stats: FarClipmapBuildStats | undefined): void {
  if (stats) {
    stats.fallbackSamples++;
    stats.exceptionSamples++;
  }
}

function pushGridIndices(indices: number[], resolution: number): void {
  const segments = resolution - 1;
  for (let z = 0; z < segments; z++) {
    for (let x = 0; x < segments; x++) {
      const a = z * resolution + x;
      const b = a + 1;
      const c = a + resolution;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
}

function localGridGeometry(resolution: number): THREE.BufferGeometry {
  const segments = resolution - 1;
  const vertexCount = resolution * resolution;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  let cursor = 0;
  let uvCursor = 0;

  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      const u = x / segments;
      const v = z / segments;
      positions[cursor] = x;
      normals[cursor++] = 0;
      positions[cursor] = 0;
      normals[cursor++] = 1;
      positions[cursor] = z;
      normals[cursor++] = 0;
      uvs[uvCursor++] = u;
      uvs[uvCursor++] = v;
    }
  }

  const indices: number[] = [];
  pushGridIndices(indices, resolution);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function sampleExactSummary(
  source: FarClipmapSource,
  x: number,
  z: number,
  distanceM: number,
  stats: FarClipmapBuildStats | undefined,
): boolean {
  if (!source.sampleSummaryInto) return true;
  const scratch: FarHeightProviderSample = {
    height: 0,
    normalX: 0,
    normalY: 1,
    normalZ: 0,
    material: 0,
    waterCoverage: 0,
  };
  try {
    const ok = source.sampleSummaryInto(x, z, distanceM, scratch);
    if (!ok || !Number.isFinite(scratch.height) || !Number.isFinite(scratch.material)) {
      recordFallback(stats);
      return false;
    }
    return true;
  } catch {
    recordException(stats);
    return false;
  }
}

export function validateFarClipmapSummaryCoverage(options: FarClipmapTerrainGeometryOptions): boolean {
  const resolution = safeGridResolution(options.gridResolution);
  const segments = resolution - 1;
  const diameter = options.outerRadiusM * 2;
  const step = diameter / segments;
  const originX = options.centerX - options.outerRadiusM;
  const originZ = options.centerZ - options.outerRadiusM;
  let triangles = 0;
  let ok = true;

  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      const worldX = originX + x * step;
      const worldZ = originZ + z * step;
      const distance = Math.hypot(worldX - options.centerX, worldZ - options.centerZ);
      if (distance < options.innerRadiusM || distance > options.outerRadiusM) continue;
      if (!sampleExactSummary(options.source, worldX, worldZ, distance, options.stats)) ok = false;
    }
  }

  for (let z = 0; z < segments; z++) {
    for (let x = 0; x < segments; x++) {
      const cx = originX + (x + 0.5) * step;
      const cz = originZ + (z + 0.5) * step;
      const distance = Math.hypot(cx - options.centerX, cz - options.centerZ);
      if (distance >= options.innerRadiusM && distance <= options.outerRadiusM) triangles += 2;
    }
  }

  if (options.stats) {
    options.stats.vertices += resolution * resolution;
    options.stats.triangles += triangles;
  }
  return ok;
}

export function createFarClipmapGridGeometry(options: FarClipmapGridGeometryOptions): THREE.BufferGeometry {
  return localGridGeometry(safeGridResolution(options.gridResolution));
}

export function createFarClipmapTerrainGeometry(options: FarClipmapTerrainGeometryOptions): THREE.BufferGeometry {
  validateFarClipmapSummaryCoverage(options);
  void options.heightScale;
  void options.yOffset;
  return createFarClipmapGridGeometry({ gridResolution: options.gridResolution });
}
