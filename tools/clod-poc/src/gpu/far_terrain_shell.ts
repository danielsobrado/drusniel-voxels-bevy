// LV-2: Far terrain vista shell (~1.8–4 km).
//
// A horizon skirt that SURROUNDS the built world.  The interior square [0, worldSize] is owned
// by the live CLOD pages; the skirt owns everything outside it, out to `farRadius` from the
// world center.  Heights inside the world come from the LV-1b terrain summary; beyond the world
// they come from the analytic terrain field (which continues infinitely), cross-faded near the
// edge so the join is seamless, and receding toward a base level into the distance.  Unlit TSL
// material reproduces the terrain hemispheric + sun shading (the scene has no THREE.Light
// objects — terrain_node_material.ts lights in the node graph, so a stock MeshStandardMaterial
// renders black here), and fades to the sky/haze colour near the rim.  No collider, no edit, no
// heavy shadows.

import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { clamp, dot, float, max, mix, normalGeometry, normalize, positionWorld, pow, smoothstep, uniform, vec2, vec3 } from "three/tsl";
import type { TerrainSummaryField } from "../clod/terrain_summary.js";
import { sampleSkirtHeight, summaryBaseLevel } from "../clod/terrain_summary.js";

/**
 * Lighting inputs for the far shell — structurally an EnvironmentLighting (environment.ts).
 * The scene has NO THREE.Light objects: the terrain is lit entirely inside the TSL node graph
 * (terrain_node_material.ts), so the shell must reproduce the same hemispheric + sun model in
 * its own colorNode.
 */
export interface FarShellLighting {
  sunDirection: THREE.Vector3;
  sunColor: THREE.Color;
  skyLight: THREE.Color;
  groundLight: THREE.Color;
}

export interface FarTerrainShellOptions {
  /** Skirt half-extent in world units from world center. Default: worldSize * 1.5 (auto when <= 0) */
  farRadius: number;
  /**
   * World-square inset in world units.  Quads lying fully inside [inset, worldSize-inset]² are
   * skipped (owned by the pages); the skirt overlaps the world edge by this much for a seamless
   * join.  Default: worldSize * 0.04 (auto when < 0).
   */
  inset: number;
  /** Grid resolution (vertices per axis). Default: 128 */
  gridRes: number;
  /** Height offset to drop the skirt below page terrain (prevent z-fighting in the overlap). Default: 2 */
  heightDrop: number;
  /**
   * Height bias for blended sampling: 0 = valley floor (heightMin), 1 = peak (heightMax).
   * Default 0.6 places the skirt at a representative mid-surface height.
   */
  heightBias: number;
}

export interface FarTerrainShell {
  mesh: THREE.Mesh;
  triangleCount: number;
  dispose: () => void;
}

const DEFAULT_OPTIONS: FarTerrainShellOptions = {
  farRadius: 0, // auto: worldSize * 1.5
  inset: -1, // auto: worldSize * 0.04
  gridRes: 128,
  heightDrop: 2,
  heightBias: 0.6,
};

/**
 * Build the far terrain shell geometry and material.
 *
 * The grid spans [center - farRadius, center + farRadius] (center = worldSize/2). Quads fully
 * inside the page-covered world square are excluded, leaving a skirt around the world that
 * extends out to the horizon.
 */
export function buildFarTerrainShell(
  summary: TerrainSummaryField,
  lighting: FarShellLighting,
  options: Partial<FarTerrainShellOptions> = {},
): FarTerrainShell {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { gridRes, heightDrop, heightBias } = opts;

  const worldSize = summary.worldSize;
  const center = worldSize / 2;
  const farRadius = opts.farRadius > 0 ? opts.farRadius : worldSize * 1.5;
  const inset = opts.inset >= 0 ? opts.inset : worldSize * 0.04;
  const extent = 2 * farRadius;
  const origin = center - farRadius; // grid min in both X and Z
  const cellSize = extent / gridRes;
  const baseLevel = summaryBaseLevel(summary);

  const vertexCount = (gridRes + 1) * (gridRes + 1);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices: number[] = [];

  // Pass 1: bake the skirt height for every vertex (analytic beyond the world, baked inside).
  const heightGrid = new Float32Array(vertexCount);
  for (let gz = 0; gz <= gridRes; gz++) {
    for (let gx = 0; gx <= gridRes; gx++) {
      const wx = origin + gx * cellSize;
      const wz = origin + gz * cellSize;
      // Constant drop so the overlap band sits just below the page terrain (no z-fight).
      heightGrid[gz * (gridRes + 1) + gx] =
        sampleSkirtHeight(summary, wx, wz, farRadius, baseLevel, heightBias) - heightDrop;
    }
  }

  // Pass 2: positions, UVs, and central-difference normals over the baked height grid.
  for (let gz = 0; gz <= gridRes; gz++) {
    for (let gx = 0; gx <= gridRes; gx++) {
      const vi = gz * (gridRes + 1) + gx;
      positions[vi * 3] = origin + gx * cellSize;
      positions[vi * 3 + 1] = heightGrid[vi];
      positions[vi * 3 + 2] = origin + gz * cellSize;

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

  // Build indices — skip quads lying fully inside the page-covered world square [inset,
  // worldSize-inset]².  A circular hole over a square world would leave the corners/edges
  // sheeted over the near terrain; the square test excludes exactly the interior the pages own.
  const innerMin = inset;
  const innerMax = worldSize - inset;
  for (let gz = 0; gz < gridRes; gz++) {
    for (let gx = 0; gx < gridRes; gx++) {
      const x0 = origin + gx * cellSize;
      const x1 = x0 + cellSize;
      const z0 = origin + gz * cellSize;
      const z1 = z0 + cellSize;
      const fullyInside = x0 >= innerMin && x1 <= innerMax && z0 >= innerMin && z1 <= innerMax;
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

  // Unlit TSL material: reproduce terrain_node_material's hemispheric sky/ground + sun^1.35,
  // then fade to the sky/haze colour near the rim so the outer edge dissolves into the horizon.
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
  const centerN = float(center);
  const distXZ = vec2(positionWorld.x.sub(centerN), positionWorld.z.sub(centerN)).length();
  const hazeT = smoothstep(float(farRadius * 0.55), float(farRadius * 0.98), distXZ);
  const material = new MeshBasicNodeMaterial();
  material.colorNode = mix(base.mul(light), uHaze, hazeT);

  // Disable shadow casting (LV-3 handles far shadows via proxy)
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false; // always visible (the shell is the horizon)

  return {
    mesh,
    triangleCount: indices.length / 3,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}
