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
// === cameraRelativeShell (future) ===
// For true infinite streaming, the excluded inner area should be centred on the stream centre /
// camera instead of assuming a fixed [inset, worldSize - inset] square.  The inner exclusion
// zone should match the live CLOD page ring (not the full world square).  When buildRelative is
// set, the mesh is built at (0,0) and translated by the controller, but the interior exclusion
// still uses the finite-world square — a camera-relative exclusion mode is TODO.

import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { clamp, dot, float, max, mix, normalGeometry, normalize, positionWorld, pow, smoothstep, uniform, vec2, vec3 } from "three/tsl";
import type { TerrainSummaryField } from "../clod/terrain_summary.js";
import { sampleSkirtHeight, summaryBaseLevel } from "../clod/terrain_summary.js";

/**
 * Height provider interface — alternative to TerrainSummaryField for the far shell.
 * Enables the far summary clipmap to drive the shell without finite-world assumptions.
 */
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
  /** Build geometry relative to (0,0) so the mesh can be moved via mesh.position.
   *  When set, centerX/centerZ are only used for the material haze fade. */
  buildRelative?: boolean;
}

export interface FarTerrainShell {
  mesh: THREE.Mesh;
  triangleCount: number;
  /** World-space center this shell was built for (used by the controller for delta-move). */
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
};

/**
 * Build the far terrain shell geometry and material.
 *
 * In finiteWorldSkirt mode (default): the grid spans [center - farRadius, center + farRadius].
 * Quads fully inside the page-covered world square [inset, worldSize - inset] are excluded,
 * leaving a skirt around the world that extends out to the horizon.
 *
 * When `heightProvider` is set (far summary streaming), the interior exclusion is skipped
 * so the shell covers the full grid — the clipmap fills in heights everywhere.
 *
 * When `buildRelative` is set, geometry is built at origin (0,0) and the caller positions
 * the mesh.  This enables the controller to translate the shell without rebuilding.
 */
export function buildFarTerrainShell(
  summary: TerrainSummaryField,
  lighting: FarShellLighting,
  options: Partial<FarTerrainShellOptions> = {},
): FarTerrainShell {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { gridRes, heightDrop, heightBias, heightProvider, buildRelative } = opts;

  const worldSize = summary.worldSize;
  const centerX = opts.centerX ?? worldSize / 2;
  const centerZ = opts.centerZ ?? worldSize / 2;
  const farRadius = opts.farRadius > 0 ? opts.farRadius : worldSize * 1.5;
  const inset = opts.inset >= 0 ? opts.inset : worldSize * 0.04;
  const extent = 2 * farRadius;
  const cellSize = extent / gridRes;
  const baseLevel = summaryBaseLevel(summary);

  // Build geometry relative to (0,0) when buildRelative is set.
  // The mesh will be positioned at the stream center by the caller.
  const buildCenterX = buildRelative ? 0 : centerX;
  const buildCenterZ = buildRelative ? 0 : centerZ;
  const originX = buildCenterX - farRadius;
  const originZ = buildCenterZ - farRadius;

  const vertexCount = (gridRes + 1) * (gridRes + 1);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices: number[] = [];

  const heightGrid = new Float32Array(vertexCount);
  for (let gz = 0; gz <= gridRes; gz++) {
    for (let gx = 0; gx <= gridRes; gx++) {
      const wx = originX + gx * cellSize;
      const wz = originZ + gz * cellSize;
      const h = heightProvider
        ? heightProvider.sampleHeight(wx, wz)
        : sampleSkirtHeight(summary, wx, wz, farRadius, baseLevel, heightBias);
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

  const innerMin = inset;
  const innerMax = worldSize - inset;
  for (let gz = 0; gz < gridRes; gz++) {
    for (let gx = 0; gx < gridRes; gx++) {
      const x0 = originX + gx * cellSize;
      const x1 = x0 + cellSize;
      const z0 = originZ + gz * cellSize;
      const z1 = z0 + cellSize;
      const fullyInside = heightProvider ? false : (x0 >= innerMin && x1 <= innerMax && z0 >= innerMin && z1 <= innerMax);
      if (fullyInside) continue;
      const a = gz * (gridRes + 1) + gx;
      const b = a + 1;
      const c = a + (gridRes + 1);
      const d = c + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
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
  const distXZ = vec2(positionWorld.x.sub(ctrX), positionWorld.z.sub(ctrZ)).length();
  const hazeT = smoothstep(float(farRadius * 0.55), float(farRadius * 0.98), distXZ);
  const material = new MeshBasicNodeMaterial();
  material.colorNode = mix(base.mul(light), uHaze, hazeT);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
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
