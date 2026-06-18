// Phase 2 WebGPU terrain material (docs/webgpu-migration.md). TSL port of src/terrain_shader.ts.
//
// Ported (2a): world-space normals, hemispheric sky/ground + sun^1.35, Blinn-Phong spec,
//              colour adjustments (brightness/contrast/saturation/warmth).
// Ported (2b): triplanar texture-array albedo with height-band blending across slots.
// NOT yet ported (2c, in the full app where the data exists): normal-map triplanar,
//              per-vertex paint blend, LOD cross-fade dither, the non-triplanar planar path,
//              and the nearest-band fallback (here simplified to a clamped denominator).
//
// Terrain meshes carry WORLD-space positions and normals (identity model transform), so the
// geometry-space TSL accessors map 1:1 onto the WebGL lighting math.

import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  cameraPosition,
  clamp,
  dot,
  float,
  max,
  mix,
  normalGeometry,
  normalize,
  pow,
  positionGeometry,
  smoothstep,
  step,
  sub,
  texture,
  uniform,
  vec3,
} from "three/tsl";

export interface TerrainNodeLighting {
  /** Normalized light direction (matches terrain uLight). */
  lightDir: THREE.Vector3;
  sunColor: THREE.Color;
  skyLight: THREE.Color;
  groundLight: THREE.Color;
  baseColor: THREE.Color;
  /** Clamped 0.04..1; bakes specular shininess/gain (static for now). */
  roughness: number;
}

export interface TerrainColorAdjust {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
}

export interface TerrainNodeTextureSlot {
  /** World-space sample scale (cells^-1), already including the global texture scale. */
  scale: number;
  heightMin: number;
  heightMax: number;
}

export interface TerrainNodeTextures {
  albedoArray: THREE.DataArrayTexture;
  slots: TerrainNodeTextureSlot[];
  blendBands: boolean;
  blendWidth: number;
}

export interface TerrainNodeMaterialOptions {
  lighting?: TerrainNodeLighting;
  adjust?: TerrainColorAdjust;
  textures?: TerrainNodeTextures | null;
}

// Mirrors createTerrainTextureUniforms() defaults in src/terrain_shader.ts.
export const DEFAULT_TERRAIN_NODE_LIGHTING: TerrainNodeLighting = {
  lightDir: new THREE.Vector3(-0.35, 0.82, 0.45).normalize(),
  sunColor: new THREE.Color(0.95, 0.86, 0.68),
  skyLight: new THREE.Color(0.42, 0.48, 0.58),
  groundLight: new THREE.Color(0.18, 0.16, 0.13),
  baseColor: new THREE.Color(0xb9c0c8),
  roughness: 0.9,
};

export const DEFAULT_TERRAIN_COLOR_ADJUST: TerrainColorAdjust = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
  warmth: 0,
};

export interface TerrainNodeMaterialHandle {
  material: MeshBasicNodeMaterial;
  /** Update lighting/colour uniforms in place (roughness/textures are baked). */
  setLighting(next: Partial<Omit<TerrainNodeLighting, "roughness">>): void;
}

const v3 = (c: THREE.Color): THREE.Vector3 => new THREE.Vector3(c.r, c.g, c.b);

// TSL Node has no exported type surface we depend on here; the graph is built dynamically.
/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

// abs(n)^4 triplanar weights, normalized — matches terrain_shader.ts triplanarWeights.
function triplanarWeights(n: TslNode): TslNode {
  const a: TslNode = abs(n);
  const w: TslNode = vec3(pow(a.x, 4), pow(a.y, 4), pow(a.z, 4));
  return w.div(max(w.x.add(w.y).add(w.z), 0.001));
}

// Triplanar sample of one array layer (yz/xz/xy planes blended by weights).
function triplanarAlbedo(
  albedo: THREE.DataArrayTexture,
  layer: number,
  worldPos: TslNode,
  scale: number,
  weights: TslNode,
): TslNode {
  const layerN = float(layer);
  const cy = texture(albedo, worldPos.yz.mul(scale)).depth(layerN).rgb;
  const cz = texture(albedo, worldPos.xz.mul(scale)).depth(layerN).rgb;
  const cx = texture(albedo, worldPos.xy.mul(scale)).depth(layerN).rgb;
  return cy.mul(weights.x).add(cz.mul(weights.y)).add(cx.mul(weights.z));
}

// step/smoothstep height band — matches terrain_shader.ts rangeWeight. min/max/width are
// per-slot constants, so the band is baked per material instance.
function rangeWeight(height: TslNode, slot: TerrainNodeTextureSlot, blendBands: boolean, blendWidth: number): TslNode {
  if (!blendBands) {
    return step(slot.heightMin, height).mul(step(height, slot.heightMax));
  }
  const w = Math.max(blendWidth, 0.0001);
  const aboveLow = smoothstep(slot.heightMin - w, slot.heightMin + w, height);
  const belowHigh = sub(1, smoothstep(slot.heightMax - w, slot.heightMax + w, height));
  return aboveLow.mul(belowHigh);
}

function adjustColor(color: TslNode, adj: TerrainColorAdjust): TslNode {
  let c = color.mul(adj.brightness);
  c = c.sub(0.5).mul(adj.contrast).add(0.5);
  const luma = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(luma), c, adj.saturation);
  const warm = vec3(1 + adj.warmth * 0.16, 1 + adj.warmth * 0.05, 1 - adj.warmth * 0.12);
  return max(c.mul(warm), vec3(0));
}

export function createTerrainNodeMaterial(
  options: TerrainNodeMaterialOptions = {},
): TerrainNodeMaterialHandle {
  const lighting = options.lighting ?? DEFAULT_TERRAIN_NODE_LIGHTING;
  const adjust = options.adjust ?? DEFAULT_TERRAIN_COLOR_ADJUST;
  const textures = options.textures ?? null;

  // Raw vec3 uniforms (not Color uniforms) so values pass through unchanged, matching the
  // custom GLSL uniforms which were never colour-managed.
  const uLight = uniform(lighting.lightDir.clone());
  const uSun = uniform(v3(lighting.sunColor));
  const uSky = uniform(v3(lighting.skyLight));
  const uGround = uniform(v3(lighting.groundLight));
  const uColor = uniform(v3(lighting.baseColor));

  const rough = Math.min(Math.max(lighting.roughness, 0.04), 1.0);
  const shininess = 128 * (1 - rough) + 4 * rough; // mix(128, 4, rough)
  const specGain = 1 - rough;

  const n = normalize(normalGeometry);
  const worldPos = positionGeometry;

  // baseColor: textured triplanar height-band blend, else flat uColor.
  let baseColor: TslNode = uColor;
  if (textures && textures.slots.length > 0) {
    const weights = triplanarWeights(n);
    const height = worldPos.y;
    let acc: TslNode = vec3(0);
    let wsum: TslNode = float(0);
    textures.slots.forEach((slot, i) => {
      const sample = triplanarAlbedo(textures.albedoArray, i, worldPos, slot.scale, weights);
      const w = rangeWeight(height, slot, textures.blendBands, textures.blendWidth);
      acc = acc.add(sample.mul(w));
      wsum = wsum.add(w);
    });
    const tex = acc.div(max(wsum, 0.001));
    // baseColor = tex * mix(vec3(1), uColor, 0.35)  (see main.ts texturing branch)
    baseColor = tex.mul(mix(vec3(1), uColor, 0.35));
  }

  baseColor = adjustColor(baseColor, adjust);

  const sun = max(dot(n, uLight), 0.0);
  const sky = clamp(n.y.mul(0.5).add(0.5), 0.0, 1.0);
  const hemi = mix(uGround, uSky, sky);
  const light = hemi.add(uSun.mul(pow(sun, 1.35)));
  const viewDir = normalize(cameraPosition.sub(worldPos));
  const halfVec = normalize(uLight.add(viewDir));
  const spec = pow(max(dot(n, halfVec), 0.0), shininess).mul(specGain).mul(sun);
  const diffuse = baseColor.mul(light);

  // Unlit material: the lighting model is computed entirely in the node graph. The renderer
  // applies tone mapping + output color space (the GLSL did this via the tonemapping/
  // colorspace chunks), so colorNode is the linear pre-tonemap colour.
  const material = new MeshBasicNodeMaterial();
  material.colorNode = diffuse.add(uSun.mul(spec));
  material.side = THREE.DoubleSide;

  return {
    material,
    setLighting(next) {
      if (next.lightDir) uLight.value.copy(next.lightDir);
      if (next.sunColor) uSun.value.copy(v3(next.sunColor));
      if (next.skyLight) uSky.value.copy(v3(next.skyLight));
      if (next.groundLight) uGround.value.copy(v3(next.groundLight));
      if (next.baseColor) uColor.value.copy(v3(next.baseColor));
    },
  };
}
