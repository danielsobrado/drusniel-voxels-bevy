// LV-2: Far terrain vista shell (~1.8–4 km).
//
// === finiteWorldSkirt mode (default) ===
// A horizon skirt that SURROUNDS the built world.  The interior square [0, worldSize] is owned
// by the live CLOD pages; the skirt owns everything outside it, out to `farRadius` from the
// world center.  Heights inside the world come from the LV-1b terrain summary; beyond the world
// they come from the analytic terrain field (which continues infinitely), cross-faded near the
// edge so the join is seamless, and receding toward a base level into the distance.  Unlit TSL
// material reproduces the terrain hemispheric + sun shading (the scene has no THREE.Light
// objects — terrain_node_material.ts lights in the node graph, so a stock MeshStandardMaterial
// renders black here), and fades to the sky/haze colour near the rim.  No collider, no edit, no
// heavy shadows.
//
// === cameraRelativeShell mode ===
// When `innerExclusionRadius` is set, the shell becomes a stream-centered annulus.  The inner
// circle is owned by live chunks/CLOD pages; the shell owns only the visual horizon band between
// `innerExclusionRadius` and `farRadius`.  This keeps the player inside the playable terrain
// bubble and prevents the visual shell from covering the main area while the stream center moves.

import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { clamp, dot, float, max, mix, normalGeometry, normalize, positionGeometry, positionWorld, pow, smoothstep, uniform, vec2, vec3 } from "three/tsl";
import type { TerrainSummaryField } from "../clod/terrain_summary.js";
import { sampleSkirtHeight, summaryBaseLevel } from "../clod/terrain_summary.js";
import { createFarTerrainMaterial, computeFarTerrainVertexColors, createVertexColorBuffer } from "../farTerrain/farTerrainMaterial.js";

export interface FarHeightProvider {
  sampleHeight(x: number, z: number): number;
  sampleNormal(x: number, z: number): THREE.Vector3;
}

export interface FarShellLighting {
  sunDirection: THREE.Vector3;
  sunColor: THREE.Color;
  skyLight: THREE.Color;
  groundLight: THREE.Color;
}

export interface FarTerrainShellOptions {
  farRadius: number;
  inset: number;
  gridRes: number;
  heightDrop: number;
  heightBias: number;
  heightProvider?: FarHeightProvider;
  centerX?: number;
  centerZ?: number;
  innerExclusionRadius?: number;
  buildRelative?: boolean;
  receiveSunShadows?: boolean;
  useDebugLambertReceiver?: boolean;
  useParityMaterial?: boolean;
  parityConfig?: import("../farTerrain/farTerrainUniforms.js").FarTerrainUniformData;
}

export interface FarTerrainShell {
  mesh: THREE.Mesh;
  triangleCount: number;
  buildCenterX: number;
  buildCenterZ: number;
  dispose: () => void;
}

const DEFAULT_OPTIONS: FarTerrainShellOptions = {
  farRadius: 0,
  inset: -1,
  gridRes: 128,
  heightDrop: 2,
  heightBias: 0.6,
  innerExclusionRadius: 0,
};

export function buildFarTerrainShell(
  summary: TerrainSummaryField,
  lighting: FarShellLighting,
  options: Partial<FarTerrainShellOptions> = {},
): FarTerrainShell {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { gridRes, heightDrop, heightBias, heightProvider, buildRelative, receiveSunShadows, useDebugLambertReceiver, useParityMaterial, parityConfig } = opts;
  const worldSize = summary.worldSize;
  const centerX = opts.centerX ?? worldSize / 2;
  const centerZ = opts.centerZ ?? worldSize / 2;
  const farRadius = opts.farRadius > 0 ? opts.farRadius : worldSize * 1.5;
  const inset = opts.inset >= 0 ? opts.inset : worldSize * 0.04;
  const innerExclusionRadius = Math.max(0, Math.min(opts.innerExclusionRadius ?? 0, farRadius));
  const useRadialExclusion = innerExclusionRadius > 0;
  const extent = 2 * farRadius;
  const cellSize = extent / gridRes;
  const baseLevel = summaryBaseLevel(summary);
  const buildCenterX = buildRelative ? 0 : centerX;
  const buildCenterZ = buildRelative ? 0 : centerZ;
  const originX = buildCenterX - farRadius;
  const originZ = buildCenterZ - farRadius;
  const fallbackHeight = (x: number, z: number): number => sampleSkirtHeight(summary, x, z, farRadius, baseLevel, heightBias);
  const sampleHeight = (x: number, z: number): number => {
    if (!heightProvider) return fallbackHeight(x, z);
    try {
      const h = heightProvider.sampleHeight(x, z);
      return Number.isFinite(h) ? h : fallbackHeight(x, z);
    } catch {
      return fallbackHeight(x, z);
    }
  };

  const vertexCount = (gridRes + 1) * (gridRes + 1);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices: number[] = [];
  const heightGrid = new Float32Array(vertexCount);

  for (let gz = 0; gz <= gridRes; gz++) {
    for (let gx = 0; gx <= gridRes; gx++) {
      const localX = originX + gx * cellSize;
      const localZ = originZ + gz * cellSize;
      const sampleX = buildRelative ? localX + centerX : localX;
      const sampleZ = buildRelative ? localZ + centerZ : localZ;
      const h = sampleHeight(sampleX, sampleZ);
      heightGrid[gz * (gridRes + 1) + gx] = h - heightDrop;
    }
  }

  for (let gz = 0; gz <= gridRes; gz++) {
    for (let gx = 0; gx <= gridRes; gx++) {
      const vi = gz * (gridRes + 1) + gx;
      positions[vi * 3] = originX + gx * cellSize;
      positions[vi * 3 + 1] = heightGrid[vi];
      positions[vi * 3 + 2] = originZ + gz * cellSize;
      const xl = Math.max(0, gx - 1);
      const xr = Math.min(gridRes, gx + 1);
      const zd = Math.max(0, gz - 1);
      const zu = Math.min(gridRes, gz + 1);
      const hL = heightGrid[gz * (gridRes + 1) + xl];
      const hR = heightGrid[gz * (gridRes + 1) + xr];
      const hD = heightGrid[zd * (gridRes + 1) + gx];
      const hU = heightGrid[zu * (gridRes + 1) + gx];
      const nx = (hL - hR) / (2 * cellSize);
      const nz = (hD - hU) / (2 * cellSize);
      const len = Math.hypot(nx, 1, nz) || 1;
      normals[vi * 3] = nx / len;
      normals[vi * 3 + 1] = 1 / len;
      normals[vi * 3 + 2] = nz / len;
      uvs[vi * 2] = gx / gridRes;
      uvs[vi * 2 + 1] = gz / gridRes;
    }
  }

  const quadRadiusBounds = (x0: number, z0: number, x1: number, z1: number): { min: number; max: number } => {
    const wx0 = buildRelative ? x0 + centerX : x0;
    const wz0 = buildRelative ? z0 + centerZ : z0;
    const wx1 = buildRelative ? x1 + centerX : x1;
    const wz1 = buildRelative ? z1 + centerZ : z1;
    const d00 = Math.hypot(wx0 - centerX, wz0 - centerZ);
    const d10 = Math.hypot(wx1 - centerX, wz0 - centerZ);
    const d01 = Math.hypot(wx0 - centerX, wz1 - centerZ);
    const d11 = Math.hypot(wx1 - centerX, wz1 - centerZ);
    return { min: Math.min(d00, d10, d01, d11), max: Math.max(d00, d10, d01, d11) };
  };

  const innerMin = inset;
  const innerMax = worldSize - inset;
  for (let gz = 0; gz < gridRes; gz++) {
    for (let gx = 0; gx < gridRes; gx++) {
      const x0 = originX + gx * cellSize;
      const x1 = x0 + cellSize;
      const z0 = originZ + gz * cellSize;
      const z1 = z0 + cellSize;
      if (useRadialExclusion) {
        const bounds = quadRadiusBounds(x0, z0, x1, z1);
        if (bounds.max <= innerExclusionRadius || bounds.min >= farRadius) continue;
      } else {
        const fullyInside = x0 >= innerMin && x1 <= innerMax && z0 >= innerMin && z1 <= innerMax;
        if (fullyInside) continue;
      }
      const a = gz * (gridRes + 1) + gx;
      const b = a + 1;
      const c = a + (gridRes + 1);
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);

  const v3 = (c: THREE.Color) => vec3(c.r, c.g, c.b);
  const n = normalize(normalGeometry);
  const uLight = uniform(lighting.sunDirection.clone());
  const uSun = uniform(v3(lighting.sunColor));
  const uSky = uniform(v3(lighting.skyLight));
  const uGround = uniform(v3(lighting.groundLight));
  const uHaze = uniform(v3(lighting.skyLight));
  const base = vec3(0.30, 0.34, 0.22);
  const sun = max(dot(n, uLight), 0.0);
  const sky = clamp(n.y.mul(0.5).add(0.5), 0.0, 1.0);
  const hemi = mix(uGround, uSky, sky);
  const light = hemi.add(uSun.mul(pow(sun, 1.35)));
  const ctrX = float(centerX);
  const ctrZ = float(centerZ);
  const distXZ = buildRelative
    ? vec2(positionGeometry.x, positionGeometry.z).length()
    : vec2(positionWorld.x.sub(ctrX), positionWorld.z.sub(ctrZ)).length();
  const hazeT = smoothstep(float(farRadius * 0.55), float(farRadius * 0.98), distXZ);

  if (useParityMaterial && parityConfig) {
    const colorWorldOffsetX = buildRelative ? centerX : 0;
    const colorWorldOffsetZ = buildRelative ? centerZ : 0;
    const debugCenterX = buildRelative ? 0 : centerX;
    const debugCenterZ = buildRelative ? 0 : centerZ;
    const vc = computeFarTerrainVertexColors(positions, normals, vertexCount, parityConfig, colorWorldOffsetX, colorWorldOffsetZ);
    const colorAttr = createVertexColorBuffer(vc, parityConfig, normals, debugCenterX, debugCenterZ, positions);
    geometry.setAttribute("color", new THREE.BufferAttribute(colorAttr, 3));
  }

  let material: THREE.Material;
  if (useParityMaterial && parityConfig) {
    material = createFarTerrainMaterial(lighting, parityConfig, centerX, centerZ, farRadius);
  } else if (receiveSunShadows && useDebugLambertReceiver) {
    material = new THREE.MeshLambertMaterial({ color: 0x5a6b42, side: THREE.DoubleSide });
  } else {
    const nodeMaterial = new MeshBasicNodeMaterial();
    nodeMaterial.colorNode = mix(base.mul(light), uHaze, hazeT);
    material = nodeMaterial;
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = receiveSunShadows ?? false;
  mesh.frustumCulled = false;

  return {
    mesh,
    triangleCount: indices.length / 3,
    buildCenterX,
    buildCenterZ,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}
