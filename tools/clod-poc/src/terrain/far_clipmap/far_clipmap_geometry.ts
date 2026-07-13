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
    waterLevel: 0,
    bodyKind: 0,
    shoreDistance: 0,
    flowX: 0,
    flowZ: 0,
    canopyCoverage: 0,
    canopyHeightAvg: 0,
    speciesPine: 0,
    speciesBroadleaf: 0,
    speciesDeadwood: 0,
    structureCoverage: 0,
    caveEntranceCoverage: 0,
    occluderHeight: 0,
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

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

function mix(v0: number, v1: number, t: number): number {
  return v0 * (1.0 - t) + v1 * t;
}

function farTerrainBaseColor(height: number, normalY: number): THREE.Color {
  const slope = 1.0 - clamp(normalY, 0.0, 1.0);
  if (height <= 0.25) return new THREE.Color(0.07, 0.18, 0.25);
  if (height < 4.0) return new THREE.Color(0.42, 0.36, 0.20);
  const grass = [0.20, 0.27, 0.18];
  const rock = [0.35, 0.34, 0.30];
  const highland = [0.32, 0.36, 0.24];
  const tSlope = smoothstep(0.32, 0.72, slope);
  const r = mix(grass[0], rock[0], tSlope);
  const g = mix(grass[1], rock[1], tSlope);
  const b = mix(grass[2], rock[2], tSlope);
  const tHigh = smoothstep(56.0, 180.0, height) * 0.35;
  return new THREE.Color(
    mix(r, highland[0], tHigh),
    mix(g, highland[1], tHigh),
    mix(b, highland[2], tHigh),
  );
}

export function createFarClipmapTerrainGeometry(options: FarClipmapTerrainGeometryOptions): THREE.BufferGeometry {
  validateFarClipmapSummaryCoverage(options);
  const resolution = safeGridResolution(options.gridResolution);
  const segments = resolution - 1;
  const diameter = options.outerRadiusM * 2;
  const step = diameter / segments;
  const originX = options.centerX - options.outerRadiusM;
  const originZ = options.centerZ - options.outerRadiusM;

  const vertices: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const gridIndexMap = new Map<string, number>();

  for (let gz = 0; gz < resolution; gz++) {
    for (let gx = 0; gx < resolution; gx++) {
      const worldX = originX + gx * step;
      const worldZ = originZ + gz * step;
      const distance = Math.hypot(worldX - options.centerX, worldZ - options.centerZ);
      
      const isVertexNeeded = distance >= (options.innerRadiusM - step) && distance <= (options.outerRadiusM + step);
      if (!isVertexNeeded) continue;

      const height = options.source.sampleHeight(worldX, worldZ) * options.heightScale + options.yOffset;
      
      const stepM = 2.0;
      const hL = options.source.sampleHeight(worldX - stepM, worldZ) * options.heightScale + options.yOffset;
      const hR = options.source.sampleHeight(worldX + stepM, worldZ) * options.heightScale + options.yOffset;
      const hD = options.source.sampleHeight(worldX, worldZ - stepM) * options.heightScale + options.yOffset;
      const hU = options.source.sampleHeight(worldX, worldZ + stepM) * options.heightScale + options.yOffset;
      const dx = (hR - hL) / (2.0 * stepM);
      const dz = (hU - hD) / (2.0 * stepM);
      const normal = new THREE.Vector3(-dx, 1.0, -dz).normalize();

      const color = farTerrainBaseColor(height, normal.y);

      const vertexIdx = vertices.length / 3;
      vertices.push(worldX, height, worldZ);
      normals.push(normal.x, normal.y, normal.z);
      colors.push(color.r, color.g, color.b);
      gridIndexMap.set(`${gx},${gz}`, vertexIdx);
    }
  }

  for (let gz = 0; gz < segments; gz++) {
    for (let gx = 0; gx < segments; gx++) {
      const cx = originX + (gx + 0.5) * step;
      const cz = originZ + (gz + 0.5) * step;
      const distance = Math.hypot(cx - options.centerX, cz - options.centerZ);
      if (distance < options.innerRadiusM || distance > options.outerRadiusM) continue;

      const idxA = gridIndexMap.get(`${gx},${gz}`);
      const idxB = gridIndexMap.get(`${gx + 1},${gz}`);
      const idxC = gridIndexMap.get(`${gx},${gz + 1}`);
      const idxD = gridIndexMap.get(`${gx + 1},${gz + 1}`);

      if (idxA !== undefined && idxB !== undefined && idxC !== undefined && idxD !== undefined) {
        indices.push(idxA, idxC, idxB);
        indices.push(idxB, idxC, idxD);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vertices), 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colors), 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}
