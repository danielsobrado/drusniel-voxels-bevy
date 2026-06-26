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
import type { CanopyShellConfig } from "../canopy/canopy_types_internal.js";
import type { CanopyTextureSet } from "../canopy/canopy_types.js";

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
  const farRadius = opts.farRadius > 0 ? opts.farRadius : worldSize * 1.5;
  const center = worldSize / 2;
  const set: CanopyTextureSet = {
    heightTexture,
    coverageTexture: canopyTexture,
    speciesTexture: canopyTexture,
    roughnessTexture: canopyTexture,
    originX: center - farRadius,
    originZ: center - farRadius,
    extentM: farRadius * 2,
    resolution: canopyTexture.image.width,
    syntheticFallback: true,
    revision: 0,
  };
  const config = {
    distances: {
      shellStartM: opts.fadeIn,
      shellFullM: opts.fadeIn + opts.fadeBand,
      shellEndM: farRadius,
      fadeBandM: opts.fadeBand,
      realTreeEndM: 220,
      impostorEndM: 650,
    },
    material: {
      crownBumpStrengthM: 4.5,
      horizonHazeStrength: 1,
      normalStrength: 1,
      ditherStrength: 1,
      baseTint: [0.045, 0.105, 0.05] as [number, number, number],
      pineTint: [0.085, 0.155, 0.055] as [number, number, number],
      broadleafTint: [0.1, 0.13, 0.045] as [number, number, number],
      deadwoodTint: [0.1, 0.13, 0.045] as [number, number, number],
      coverageAlphaPower: 1,
    },
  } as CanopyShellConfig;
  return buildFarCanopyShellFromTextureSet(set, config, lighting, {
    ...opts,
    worldSize,
    buildRelative: false,
    skipInteriorHole: false,
  });
}

export interface FarCanopyShellFromSourceOptions extends Partial<FarCanopyShellOptions> {
  worldSize?: number;
  buildRelative?: boolean;
  skipInteriorHole?: boolean;
  showCoverageHeatmap?: boolean;
  wireframe?: boolean;
}

/**
 * Build canopy shell from deterministic summary textures (Phase 8 path).
 */
export function buildFarCanopyShellFromTextureSet(
  textureSet: CanopyTextureSet,
  config: CanopyShellConfig,
  lighting: FarShellLighting,
  options: FarCanopyShellFromSourceOptions = {},
): FarCanopyShell {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const GRID = opts.grid;
  const { heightTexture, coverageTexture, speciesTexture, roughnessTexture } = textureSet;
  const origin = textureSet.originX;
  const extent = textureSet.extentM;
  const farRadius = extent * 0.5;
  const FADE_IN = config.distances.shellStartM;
  const FADE_BAND = config.distances.fadeBandM;
  const worldSize = options.worldSize ?? extent;
  const buildRelative = options.buildRelative ?? false;
  const center = buildRelative ? 0 : worldSize / 2;
  const inset = opts.inset >= 0 ? opts.inset : worldSize * 0.04;
  const n = GRID + 1;
  const geoOrigin = buildRelative ? -farRadius : origin;

  const pos = new Float32Array(n * n * 3);
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const i = (z * n + x) * 3;
      pos[i] = geoOrigin + (x / GRID) * extent;
      pos[i + 1] = 0;
      pos[i + 2] = geoOrigin + (z / GRID) * extent;
    }
  }
  const cell = extent / GRID;
  const innerMin = inset;
  const innerMax = worldSize - inset;
  const idx: number[] = [];
  for (let z = 0; z < GRID; z++) {
    for (let x = 0; x < GRID; x++) {
      const x0 = geoOrigin + x * cell;
      const x1 = x0 + cell;
      const z0 = geoOrigin + z * cell;
      const z1 = z0 + cell;
      if (!options.skipInteriorHole
        && x0 >= innerMin && x1 <= innerMax && z0 >= innerMin && z1 <= innerMax) continue;
      const a = z * n + x;
      idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);

  const mat = new MeshBasicNodeMaterial();
  if (options.wireframe) mat.wireframe = true;

  const originN = float(origin);
  const extentN = float(extent);
  const uvOf = (p: TslNode): TslNode =>
    vec2(p.x.sub(originN).div(extentN), p.y.sub(originN).div(extentN));
  const sampleHeightTsl = (p: TslNode): TslNode => texture(heightTexture, uvOf(p)).r;
  const sampleCanopyTsl = (p: TslNode): TslNode => texture(coverageTexture, uvOf(p)).r;
  const sampleSpeciesTsl = (p: TslNode): TslNode => texture(speciesTexture, uvOf(p));
  const sampleRoughTsl = (p: TslNode): TslNode => texture(roughnessTexture, uvOf(p)).r;

  const bumpStrength = float(config.material.crownBumpStrengthM);
  const shellY = (p: TslNode): TslNode => {
    const cov = sampleCanopyTsl(p);
    const h = sampleHeightTsl(p);
    const rough = sampleRoughTsl(p);
    const lift = smoothstep(float(0.18), float(0.5), cov).mul(cov.mul(7).add(11));
    const bump = rough.sub(0.5).mul(bumpStrength);
    return mix(
      h.sub(8),
      h.add(lift).add(bump.mul(smoothstep(float(0.2), float(0.45), cov))),
      smoothstep(float(0.16), float(0.3), cov),
    );
  };

  const e = float(cell);
  const worldXZ = vec2(positionWorld.x, positionWorld.z);
  const canopyNormalV = varying(
    vec3(
      shellY(worldXZ).sub(shellY(worldXZ.add(vec2(e, float(0))))),
      e,
      shellY(worldXZ).sub(shellY(worldXZ.add(vec2(float(0), e)))),
    ).normalize(),
  );

  mat.positionNode = Fn(() => vec3(positionLocal.x, shellY(worldXZ), positionLocal.z))();

  const worldP = vec2(positionWorld.x, positionWorld.z);
  const cov = sampleCanopyTsl(worldP);
  let albedo: TslNode = sampleSpeciesTsl(worldP);
  if (options.showCoverageHeatmap) {
    albedo = vec3(cov, cov.mul(0.2), float(0));
  }

  const v3 = (c: THREE.Color) => vec3(c.r, c.g, c.b);
  const uLight = uniform(lighting.sunDirection.clone());
  const uSun = uniform(v3(lighting.sunColor));
  const uSky = uniform(v3(lighting.skyLight));
  const uGround = uniform(v3(lighting.groundLight));
  const uHaze = uniform(v3(lighting.skyLight));
  const centerN = float(buildRelative ? origin + farRadius : center);

  const distV = varying(
    vec3(positionWorld.x, float(0), positionWorld.z).sub(cameraPosition).length(),
  );
  const ditherStrength = float(config.material.ditherStrength);
  mat.colorNode = Fn(() => {
    const fadeEdge = float(FADE_IN - FADE_BAND);
    const fadeEnd = float(FADE_IN + FADE_BAND);
    const coverageVisible = smoothstep(float(0.02), float(0.12), cov);
    Discard(
      coverageVisible.mul(smoothstep(fadeEdge, fadeEnd, distV)).mul(ditherStrength).lessThanEqual(
        interleavedGradientNoise(screenCoordinate.xy),
      ),
    );
    const nLit = normalize(canopyNormalV);
    const sun = max(dot(nLit, uLight), float(0));
    const sky = clamp(nLit.y.mul(0.5).add(0.5), float(0), float(1));
    const hemi = mix(uGround, uSky, sky);
    const light = hemi.add(uSun.mul(pow(sun, float(1.35))));
    const distXZ = vec2(positionWorld.x.sub(centerN), positionWorld.z.sub(centerN)).length();
    const hazeT = smoothstep(float(farRadius * 0.6), float(farRadius * 0.97), distXZ)
      .mul(float(config.material.horizonHazeStrength));
    return mix(albedo.mul(light), uHaze, hazeT);
  })();

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.canopyTextureSetRevision = textureSet.revision;

  return {
    mesh,
    triangleCount: idx.length / 3,
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}

export function updateFarCanopyShellTextures(shell: FarCanopyShell, textureSet: CanopyTextureSet): void {
  const mesh = shell.mesh as THREE.Mesh & { userData: { canopyTextureSetRevision?: number } };
  if (mesh.userData.canopyTextureSetRevision === textureSet.revision) return;
  mesh.userData.canopyTextureSetRevision = textureSet.revision;
  // Textures are rebuilt with new GPU objects in the PoC path; shell rebuild handles swaps.
}

