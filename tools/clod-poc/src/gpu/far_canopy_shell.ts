// LV-4: Far forest canopy shell (~600 m – 4 km).
//
// A horizon canopy skirt that SURROUNDS the built world.  One static grid spanning
// [center - farRadius, center + farRadius] (center = worldSize/2) whose vertices ride the
// extended heightfield + canopy-coverage lift + crown-scale hash bumps.  Quads fully inside the
// page-covered world square are skipped (owned by the live trees/terrain); the skirt owns the
// exterior.  The height/coverage textures cover the full skirt extent (createExtendedHeight/
// CanopyTexture), so beyond the world the base height is the analytic terrain, not a flat
// extrusion of the edge.  Forestless cells sink below terrain and z-fail; the canopy dithers IN
// past the impostor mid-range and fades to haze near the rim.
//
// Unlit TSL material: the scene has NO THREE.Light, so the foliage is lit by reproducing the
// terrain hemispheric + sun model in colorNode (a lit MeshPhysical material would show only
// its emissive term here and render flat/dark).

import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  Discard,
  Fn,
  cameraPosition,
  clamp,
  dot,
  float,
  interleavedGradientNoise,
  max,
  mix,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  screenCoordinate,
  smoothstep,
  texture,
  uniform,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import type { FarShellLighting } from "./far_terrain_shell.js";

// TSL Node has no exported type surface — the graph is built dynamically.
/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export interface FarCanopyShellOptions {
  /** Grid resolution (vertices per axis). Default: 256 */
  grid: number;
  /** Distance at which the canopy shell starts dithering in (meters from camera). Default: 620 */
  fadeIn: number;
  /** Width of the dither fade band. Default: 90 */
  fadeBand: number;
  /** Skirt half-extent in world units from world center. Default: worldSize * 1.5 (auto when <= 0) */
  farRadius: number;
  /**
   * World-square inset in world units.  Quads lying fully inside [inset, worldSize-inset]² are
   * skipped (owned by the live trees/terrain).  Default: worldSize * 0.04 (auto when < 0).
   */
  inset: number;
}

export interface FarCanopyShell {
  mesh: THREE.Mesh;
  triangleCount: number;
  dispose: () => void;
}

const DEFAULT_OPTIONS: FarCanopyShellOptions = {
  grid: 256,
  fadeIn: 620,
  fadeBand: 90,
  farRadius: 0, // auto: worldSize * 1.5
  inset: -1, // auto: worldSize * 0.04
};

/**
 * Build the far forest canopy shell — static heightfield grid surrounding the world.
 *
 * @param heightTexture  Extended r32float height texture (createExtendedHeightTexture)
 * @param canopyTexture  Extended canopy coverage texture (createExtendedCanopyTexture)
 * @param worldSize      World extent in cell units (corner-origin)
 * @param lighting       Sun/sky/ground for the unlit hemispheric model (no scene lights exist)
 *
 * Both textures must cover the skirt extent [center - farRadius, center + farRadius]; the TSL
 * samplers map world XZ into their [0,1] UV via uv = (worldXZ - origin) / extent.
 */
export function buildFarCanopyShell(
  heightTexture: THREE.DataTexture,
  canopyTexture: THREE.DataTexture,
  worldSize: number,
  lighting: FarShellLighting,
  options: Partial<FarCanopyShellOptions> = {},
): FarCanopyShell {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const GRID = opts.grid;
  const FADE_IN = opts.fadeIn;
  const FADE_BAND = opts.fadeBand;
  const center = worldSize / 2;
  const farRadius = opts.farRadius > 0 ? opts.farRadius : worldSize * 1.5;
  const inset = opts.inset >= 0 ? opts.inset : worldSize * 0.04;
  const extent = 2 * farRadius;
  const origin = center - farRadius; // grid/texture min in both X and Z
  const n = GRID + 1;

  // --- Geometry: flat grid at y=0 over [origin, origin + extent] (height set in the TSL node) ---
  const pos = new Float32Array(n * n * 3);
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const i = (z * n + x) * 3;
      pos[i] = origin + (x / GRID) * extent;
      pos[i + 1] = 0;
      pos[i + 2] = origin + (z / GRID) * extent;
    }
  }
  // Skip quads lying fully inside the page-covered world square [inset, worldSize-inset]² — the
  // near field is owned by the live trees/terrain.  The square test (vs a circular hole) excludes
  // exactly the interior, so the skirt covers the corners/edges of the world too.
  const cell = extent / GRID;
  const innerMin = inset;
  const innerMax = worldSize - inset;
  const idx: number[] = [];
  for (let z = 0; z < GRID; z++) {
    for (let x = 0; x < GRID; x++) {
      const x0 = origin + x * cell;
      const x1 = x0 + cell;
      const z0 = origin + z * cell;
      const z1 = z0 + cell;
      if (x0 >= innerMin && x1 <= innerMax && z0 >= innerMin && z1 <= innerMax) continue;
      const a = z * n + x;
      idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);

  const mat = new MeshBasicNodeMaterial();

  // TSL helpers: sample the extended textures (UV = (worldXZ - origin) / extent)
  const originN = float(origin);
  const extentN = float(extent);
  const sampleHeightTsl = (p: TslNode): TslNode =>
    texture(heightTexture, vec2(p.x.sub(originN).div(extentN), p.y.sub(originN).div(extentN))).r;
  const sampleCanopyTsl = (p: TslNode): TslNode =>
    texture(canopyTexture, vec2(p.x.sub(originN).div(extentN), p.y.sub(originN).div(extentN))).r;

  // Simple cell hash for crown-scale bumps (fract(sin) pattern)
  const cellHash2 = (p: TslNode, seed: number): TslNode => {
    const s = float(seed);
    const n1 = p.x.mul(127.1).add(p.y.mul(311.7)).add(s);
    const n2 = p.x.mul(269.5).add(p.y.mul(183.3)).add(s);
    return vec2(n1.sin().mul(43758.5453).fract(), n2.sin().mul(43758.5453).fract());
  };

  /** canopy-top height field: terrain + coverage lift + crown bumps */
  const shellY = (p: TslNode): TslNode => {
    const cov = sampleCanopyTsl(p);
    const lift = smoothstep(float(0.18), float(0.5), cov).mul(cov.mul(7).add(11));
    const bump = cellHash2(p.div(7).floor(), 911).x.sub(0.5).mul(4.5);
    const h = sampleHeightTsl(p);
    // forestless cells dive under the terrain and z-fail
    return mix(
      h.sub(8),
      h.add(lift).add(bump.mul(smoothstep(float(0.2), float(0.45), cov))),
      smoothstep(float(0.16), float(0.3), cov),
    );
  };

  // Canopy normal (finite differences), carried to the fragment stage for lighting.
  const e = float(cell);
  const pBase = vec2(positionLocal.x, positionLocal.z);
  const canopyNormalV = varying(
    vec3(
      shellY(pBase).sub(shellY(pBase.add(vec2(e, float(0))))),
      e,
      shellY(pBase).sub(shellY(pBase.add(vec2(float(0), e)))),
    ).normalize(),
  );

  mat.positionNode = Fn(() => vec3(positionLocal.x, shellY(pBase), positionLocal.z))();

  // Foliage palette by coverage + macro noise
  const cov = sampleCanopyTsl(vec2(positionWorld.x, positionWorld.z));
  const macro = positionWorld.x
    .mul(0.013)
    .add(3.1)
    .sin()
    .add(positionWorld.z.mul(0.013).sin())
    .mul(0.5)
    .add(0.5);
  let albedo: TslNode = mix(vec3(0.045, 0.105, 0.05), vec3(0.085, 0.155, 0.055), macro);
  albedo = mix(albedo, vec3(0.1, 0.13, 0.045), cov.mul(0.4));

  // Hemispheric sky/ground + sun^1.35 — reproduces terrain_node_material lighting (no scene lights).
  const v3 = (c: THREE.Color) => vec3(c.r, c.g, c.b);
  const uLight = uniform(lighting.sunDirection.clone());
  const uSun = uniform(v3(lighting.sunColor));
  const uSky = uniform(v3(lighting.skyLight));
  const uGround = uniform(v3(lighting.groundLight));
  const uHaze = uniform(v3(lighting.skyLight));
  const centerN = float(center);

  const distV = varying(
    vec3(positionLocal.x, float(0), positionLocal.z).sub(cameraPosition).length(),
  );
  mat.colorNode = Fn(() => {
    // dither IN beyond the impostor mid-band
    Discard(
      smoothstep(float(FADE_IN - FADE_BAND), float(FADE_IN + FADE_BAND), distV).lessThanEqual(
        interleavedGradientNoise(screenCoordinate.xy),
      ),
    );
    const nLit = normalize(canopyNormalV);
    const sun = max(dot(nLit, uLight), float(0));
    const sky = clamp(nLit.y.mul(0.5).add(0.5), float(0), float(1));
    const hemi = mix(uGround, uSky, sky);
    const light = hemi.add(uSun.mul(pow(sun, float(1.35))));
    // fade to sky/haze near the rim so the outer canopy dissolves into the horizon
    const distXZ = vec2(positionWorld.x.sub(centerN), positionWorld.z.sub(centerN)).length();
    const hazeT = smoothstep(float(farRadius * 0.6), float(farRadius * 0.97), distXZ);
    return mix(albedo.mul(light), uHaze, hazeT);
  })();

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  return {
    mesh,
    triangleCount: idx.length / 3,
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}
