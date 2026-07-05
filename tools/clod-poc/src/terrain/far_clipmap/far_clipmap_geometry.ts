import * as THREE from "three";
import type { FarClipmapSource } from "./far_clipmap_source.js";

export interface FarClipmapGridGeometryOptions {
  gridResolution: number;
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
}

const COLOR_GRASS = new THREE.Color(0x33442d);
const COLOR_ROCK = new THREE.Color(0x56564d);
const COLOR_SAND = new THREE.Color(0x6b6040);
const COLOR_WATER = new THREE.Color(0x203b50);

function safeGridResolution(value: number): number {
  if (!Number.isFinite(value)) return 2;
  return Math.max(2, Math.floor(value));
}

function sampleHeight(source: FarClipmapSource, x: number, z: number): number {
  try {
    const height = source.sampleHeight(x, z);
    return Number.isFinite(height) ? height : 0;
  } catch {
    return 0;
  }
}

function sampleMaterial(source: FarClipmapSource, x: number, z: number): number {
  try {
    const material = source.sampleMaterial(x, z);
    return Number.isFinite(material) ? material : 0;
  } catch {
    return 0;
  }
}

function sampleWater(source: FarClipmapSource, x: number, z: number): number {
  try {
    const water = source.sampleWater(x, z);
    return Number.isFinite(water) ? water : 0;
  } catch {
    return 0;
  }
}

function colorForSample(source: FarClipmapSource, x: number, z: number): THREE.Color {
  if (sampleWater(source, x, z) > 0.5) return COLOR_WATER;
  const material = Math.floor(sampleMaterial(source, x, z));
  if (material === 1) return COLOR_SAND;
  if (material === 2 || material === 3) return COLOR_ROCK;
  return COLOR_GRASS;
}

export function createFarClipmapGridGeometry(options: FarClipmapGridGeometryOptions): THREE.BufferGeometry {
  const resolution = safeGridResolution(options.gridResolution);
  const segments = resolution - 1;
  const vertexCount = resolution * resolution;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  let cursor = 0;
  let uvCursor = 0;

  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      const u = x / segments;
      const v = z / segments;
      positions[cursor++] = u - 0.5;
      positions[cursor++] = 0;
      positions[cursor++] = v - 0.5;
      uvs[uvCursor++] = u;
      uvs[uvCursor++] = v;
    }
  }

  const indices: number[] = [];
  for (let z = 0; z < segments; z++) {
    for (let x = 0; x < segments; x++) {
      const a = z * resolution + x;
      const b = a + 1;
      const c = a + resolution;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createFarClipmapTerrainGeometry(options: FarClipmapTerrainGeometryOptions): THREE.BufferGeometry {
  const resolution = safeGridResolution(options.gridResolution);
  const segments = resolution - 1;
  const vertexCount = resolution * resolution;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const diameter = options.outerRadiusM * 2;
  const step = diameter / segments;
  const originX = options.centerX - options.outerRadiusM;
  const originZ = options.centerZ - options.outerRadiusM;
  let cursor = 0;
  let colorCursor = 0;
  let uvCursor = 0;

  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      const u = x / segments;
      const v = z / segments;
      const worldX = originX + x * step;
      const worldZ = originZ + z * step;
      const height = sampleHeight(options.source, worldX, worldZ) * options.heightScale + options.yOffset;
      const color = colorForSample(options.source, worldX, worldZ);
      positions[cursor++] = worldX;
      positions[cursor++] = height;
      positions[cursor++] = worldZ;
      colors[colorCursor++] = color.r;
      colors[colorCursor++] = color.g;
      colors[colorCursor++] = color.b;
      uvs[uvCursor++] = u;
      uvs[uvCursor++] = v;
    }
  }

  const indices: number[] = [];
  for (let z = 0; z < segments; z++) {
    for (let x = 0; x < segments; x++) {
      const cx = originX + (x + 0.5) * step;
      const cz = originZ + (z + 0.5) * step;
      const distance = Math.hypot(cx - options.centerX, cz - options.centerZ);
      if (distance < options.innerRadiusM || distance > options.outerRadiusM) continue;
      const a = z * resolution + x;
      const b = a + 1;
      const c = a + resolution;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
