// Phase 2 WebGPU terrain material (docs/webgpu-migration.md). TSL port of src/terrain_shader.ts.
//
// Ported (2a): world-space normals, hemispheric sky/ground + sun^1.35, Blinn-Phong spec,
//              colour adjustments (brightness/contrast/saturation/warmth).
// Ported (2b): triplanar texture-array albedo with height-band blending across slots.
// Ported (2c): triplanar texture-array normal maps with height-band blending.
// Ported (2d): per-vertex paint blend via paintSlots/paintWeights geometry attributes.
// Ported (2e): screen-door LOD cross-fade dither.
// NOT yet ported: the non-triplanar planar path and the nearest-band fallback (here
//              simplified to a clamped denominator).
//
// Terrain meshes carry WORLD-space positions and normals (identity model transform), so the
// geometry-space TSL accessors map 1:1 onto the WebGL lighting math.

import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  attribute,
  cameraPosition,
  clamp,
  dot,
  float,
  fract,
  max,
  min,
  mix,
  normalGeometry,
  normalize,
  not,
  or,
  pow,
  positionGeometry,
  screenCoordinate,
  sign,
  smoothstep,
  step,
  sub,
  texture,
  uniform,
  vec3,
  vec4,
} from "three/tsl";

export interface TerrainNodeLighting {
  /** Normalized light direction (matches terrain uLight). */
  lightDir: THREE.Vector3;
  sunColor: THREE.Color;
  skyLight: THREE.Color;
  groundLight: THREE.Color;
  baseColor: THREE.Color;
  /** Clamped 0.04..1; drives specular shininess/gain. */
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
  normalArray?: THREE.DataArrayTexture | null;
  slots: TerrainNodeTextureSlot[];
  blendBands: boolean;
  blendWidth: number;
  normalIntensity?: number;
  triplanar?: boolean;
  normalMapMask?: readonly number[] | Float32Array;
  procedural?: {
    noiseA: THREE.Texture;
    noiseB: THREE.Texture;
    microFadeStart: number;
    microFadeEnd: number;
    lodBias: number;
  } | null;
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
  /** Update lighting/colour uniforms in place. */
  setLighting(next: Partial<Omit<TerrainNodeLighting, "roughness">>): void;
  setRoughness(roughness: number): void;
  setTextureParams(params: { blendWidth: number; normalIntensity: number }): void;
  setColorAdjust(adjust: TerrainColorAdjust): void;
  setDebug(state: { normalColor: boolean; normalDivergence: boolean; divergenceGain: number }): void;
  /** Drive optional screen-door LOD fades. */
  setFade(fade: number, fadeIn: boolean, dither: boolean): void;
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
  layer: number | TslNode,
  worldPos: TslNode,
  scale: number | TslNode,
  weights: TslNode,
  useTriplanar: boolean,
): TslNode {
  const layerN: TslNode = typeof layer === "number" ? float(layer) : layer;
  if (!useTriplanar) return texture(albedo, worldPos.xz.mul(scale)).depth(layerN).rgb;
  const cy = texture(albedo, worldPos.yz.mul(scale)).depth(layerN).rgb;
  const cz = texture(albedo, worldPos.xz.mul(scale)).depth(layerN).rgb;
  const cx = texture(albedo, worldPos.xy.mul(scale)).depth(layerN).rgb;
  return cy.mul(weights.x).add(cz.mul(weights.y)).add(cx.mul(weights.z));
}

function unpackNormalMap(sample: TslNode): TslNode {
  return normalize(sample.mul(2.0).sub(1.0));
}

function reorientNormal(tn: TslNode, wn: TslNode, axis: 0 | 1 | 2, normalIntensity: TslNode): TslNode {
  const n: TslNode = normalize(vec3(tn.x.mul(normalIntensity), tn.y.mul(normalIntensity), tn.z));
  if (axis === 0) return normalize(vec3(n.z.mul(sign(wn.x)), n.y, n.x));
  if (axis === 1) return normalize(vec3(n.x, n.z.mul(sign(wn.y)), n.y));
  return normalize(vec3(n.x, n.y, n.z.mul(sign(wn.z))));
}

function triplanarNormal(
  normalArray: THREE.DataArrayTexture,
  layer: number | TslNode,
  worldPos: TslNode,
  scale: number,
  baseNormal: TslNode,
  normalIntensity: TslNode,
): TslNode {
  const layerN = float(layer);
  const weights = triplanarWeights(baseNormal);
  const n0 = reorientNormal(unpackNormalMap(texture(normalArray, worldPos.yz.mul(scale)).depth(layerN).rgb), baseNormal, 0, normalIntensity);
  const n1 = reorientNormal(unpackNormalMap(texture(normalArray, worldPos.xz.mul(scale)).depth(layerN).rgb), baseNormal, 1, normalIntensity);
  const n2 = reorientNormal(unpackNormalMap(texture(normalArray, worldPos.xy.mul(scale)).depth(layerN).rgb), baseNormal, 2, normalIntensity);
  return normalize(n0.mul(weights.x).add(n1.mul(weights.y)).add(n2.mul(weights.z)));
}

function sampleTerrainNormal(
  normalArray: THREE.DataArrayTexture,
  slots: readonly TerrainNodeTextureSlot[],
  worldPos: TslNode,
  baseNormal: TslNode,
  blendBands: boolean,
  blendWidth: TslNode,
  normalIntensity: TslNode,
  normalMapMask?: readonly number[] | Float32Array,
): TslNode {
  const height = worldPos.y;
  let acc: TslNode = vec3(0);
  let wsum: TslNode = float(0);
  slots.forEach((slot, i) => {
    const sample = (normalMapMask?.[i] ?? 1) > 0.5
      ? triplanarNormal(normalArray, i, worldPos, slot.scale, baseNormal, normalIntensity)
      : baseNormal;
    const w = rangeWeight(height, slot, blendBands, blendWidth);
    acc = acc.add(sample.mul(w));
    wsum = wsum.add(w);
  });
  // Out-of-band: keep the geometry normal rather than normalize(0). Matches terrain_shader.ts.
  const detail: TslNode = acc.div(max(wsum, 0.001));
  const inBand: TslNode = step(0.0001, wsum);
  const blended: TslNode = mix(baseNormal, detail, inBand);
  return normalize(blended);
}

// step/smoothstep height band — matches terrain_shader.ts rangeWeight. min/max/width are
// per-slot constants, so the band is baked per material instance.
function rangeWeight(height: TslNode, slot: TerrainNodeTextureSlot, blendBands: boolean, blendWidth: TslNode): TslNode {
  if (!blendBands) {
    return step(slot.heightMin, height).mul(step(height, slot.heightMax));
  }
  const w: TslNode = max(blendWidth, 0.0001);
  const aboveLow = smoothstep(float(slot.heightMin).sub(w), float(slot.heightMin).add(w), height);
  const belowHigh = sub(1, smoothstep(float(slot.heightMax).sub(w), float(slot.heightMax).add(w), height));
  return aboveLow.mul(belowHigh);
}

function adjustColor(
  color: TslNode,
  brightness: TslNode,
  contrast: TslNode,
  saturation: TslNode,
  warmth: TslNode,
): TslNode {
  let c = color.mul(brightness);
  c = c.sub(0.5).mul(contrast).add(0.5);
  const luma = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(luma), c, saturation);
  const warm = vec3(warmth.mul(0.16).add(1), warmth.mul(0.05).add(1), warmth.mul(-0.12).add(1));
  return max(c.mul(warm), vec3(0));
}

function proceduralMicroWeight(worldPos: TslNode, procedural: NonNullable<TerrainNodeTextures["procedural"]>): TslNode {
  const dist: TslNode = cameraPosition.sub(worldPos).length().add(Math.max(procedural.lodBias, 0));
  return smoothstep(
    procedural.microFadeStart,
    Math.max(procedural.microFadeEnd, procedural.microFadeStart + 0.001),
    dist,
  ).oneMinus();
}

function proceduralMacroTint(baseColor: TslNode, worldPos: TslNode, normalWs: TslNode, procedural: NonNullable<TerrainNodeTextures["procedural"]>): TslNode {
  const na: TslNode = texture(procedural.noiseA, worldPos.xz.div(43.7));
  const nb: TslNode = texture(procedural.noiseB, worldPos.xz.div(23.0));
  const macroMix: TslNode = na.r.mul(0.65).add(na.g.mul(0.35));
  const slope: TslNode = clamp(max(normalWs.y, 0.0).oneMinus(), 0.0, 1.0);
  let tinted: TslNode = baseColor.mul(macroMix.sub(0.5).mul(0.16).add(1.0));
  const moss = vec3(0.11, 0.19, 0.07);
  const wet = tinted.mul(vec3(0.64, 0.68, 0.72));
  tinted = mix(tinted, moss, smoothstep(0.58, 0.86, nb.a).mul(smoothstep(0.28, 0.72, slope)).mul(0.28));
  tinted = mix(tinted, wet, smoothstep(0.04, 0.0, worldPos.y.sub(18.0)).mul(0.38));
  return max(tinted, vec3(0));
}

function paintedAlbedo(
  albedo: THREE.DataArrayTexture,
  slots: readonly TerrainNodeTextureSlot[],
  worldPos: TslNode,
  weights: TslNode,
  paintSlots: TslNode,
  paintWeights: TslNode,
  useTriplanar: boolean,
): TslNode {
  const channels = [
    { slot: paintSlots.x, weight: paintWeights.x },
    { slot: paintSlots.y, weight: paintWeights.y },
    { slot: paintSlots.z, weight: paintWeights.z },
    { slot: paintSlots.w, weight: paintWeights.w },
  ];
  let acc: TslNode = vec3(0);
  let wsum: TslNode = float(0);
  for (const channel of channels) {
    const layer = max(channel.slot, 0.0);
    // Sample the painted slot ONCE with a dynamic array layer, selecting that slot's scale
    // with cheap scalar mixes — instead of triplanar-sampling every slot per channel.
    let scale: TslNode = float(slots[0].scale);
    for (let i = 1; i < slots.length; i++) {
      scale = mix(scale, float(slots[i].scale), step(abs(layer.sub(i)), 0.5));
    }
    // Drop unpainted channels (slot < -0.5), matching the WebGL guard.
    const w = channel.weight.mul(step(0.0, channel.slot.add(0.5)));
    acc = acc.add(triplanarAlbedo(albedo, layer, worldPos, scale, weights, useTriplanar).mul(w));
    wsum = wsum.add(w);
  }
  return acc.div(max(wsum, 0.001));
}

function paintedNormal(
  normalArray: THREE.DataArrayTexture,
  slots: readonly TerrainNodeTextureSlot[],
  worldPos: TslNode,
  baseNormal: TslNode,
  paintSlots: TslNode,
  paintWeights: TslNode,
  normalIntensity: TslNode,
  normalMapMask?: readonly number[] | Float32Array,
): TslNode {
  const channels = [
    { slot: paintSlots.x, weight: paintWeights.x },
    { slot: paintSlots.y, weight: paintWeights.y },
    { slot: paintSlots.z, weight: paintWeights.z },
    { slot: paintSlots.w, weight: paintWeights.w },
  ];
  let acc: TslNode = vec3(0);
  let wsum: TslNode = float(0);
  for (const channel of channels) {
    const layer = max(channel.slot, 0.0);
    let scale: TslNode = float(slots[0].scale);
    let hasNormal: TslNode = float((normalMapMask?.[0] ?? 1) > 0.5 ? 1 : 0);
    for (let i = 1; i < slots.length; i++) {
      const selected = step(abs(layer.sub(i)), 0.5);
      scale = mix(scale, float(slots[i].scale), selected);
      hasNormal = mix(hasNormal, float((normalMapMask?.[i] ?? 1) > 0.5 ? 1 : 0), selected);
    }
    const w = channel.weight.mul(step(0.0, channel.slot.add(0.5)));
    const sample = mix(baseNormal, triplanarNormal(normalArray, layer, worldPos, scale, baseNormal, normalIntensity), hasNormal);
    acc = acc.add(sample.mul(w));
    wsum = wsum.add(w);
  }
  const detail: TslNode = acc.div(max(wsum, 0.001));
  const blended: TslNode = mix(baseNormal, detail, step(0.0001, wsum));
  return normalize(blended);
}

function interleavedGradientNoise(p: TslNode): TslNode {
  return fract(fract(p.x.mul(0.06711056).add(p.y.mul(0.00583715))).mul(52.9829189));
}

export function createTerrainNodeMaterial(
  options: TerrainNodeMaterialOptions = {},
): TerrainNodeMaterialHandle {
  const lighting = options.lighting ?? DEFAULT_TERRAIN_NODE_LIGHTING;
  const adjust = options.adjust ?? DEFAULT_TERRAIN_COLOR_ADJUST;
  const textures = options.textures ?? null;
  const useTriplanar = textures?.triplanar ?? true;

  // Raw vec3 uniforms (not Color uniforms) so values pass through unchanged, matching the
  // custom GLSL uniforms which were never colour-managed.
  const uLight = uniform(lighting.lightDir.clone());
  const uSun = uniform(v3(lighting.sunColor));
  const uSky = uniform(v3(lighting.skyLight));
  const uGround = uniform(v3(lighting.groundLight));
  const uColor = uniform(v3(lighting.baseColor));
  const uBrightness = uniform(adjust.brightness);
  const uContrast = uniform(adjust.contrast);
  const uSaturation = uniform(adjust.saturation);
  const uWarmth = uniform(adjust.warmth);
  // WGSL has no `bool` uniform type (WGSLNodeBuilder.getNodeUniform throws "Uniform 'bool' not
  // declared"); only WebGL/GLSL tolerates it. Back these toggles with 0/1 float uniforms and
  // derive bool nodes via comparison so the same graph builds on both backends.
  const uNormalColor = uniform(0);
  const uFade = uniform(1.0);
  const uFadeIn = uniform(1);
  const uDither = uniform(0);
  const normalColorOn = uNormalColor.greaterThan(0.5);
  const fadeInOn = uFadeIn.greaterThan(0.5);
  const ditherOn = uDither.greaterThan(0.5);
  const uBlendWidth = uniform(textures?.blendWidth ?? 2.5);
  const uNormalIntensity = uniform(textures?.normalIntensity ?? 1.0);
  const rough = Math.min(Math.max(lighting.roughness, 0.04), 1.0);
  const uShininess = uniform(128 * (1 - rough) + 4 * rough); // mix(128, 4, rough)
  const uSpecGain = uniform(1 - rough);

  const geomN = normalize(normalGeometry);
  const worldPos = positionGeometry;
  const paintSlots: TslNode = attribute("paintSlots", "vec4");
  const paintWeights: TslNode = attribute("paintWeights", "vec4");
  const paint = clamp(dot(paintWeights, vec4(1)), 0.0, 1.0);

  // baseColor: textured triplanar height-band blend, else flat uColor.
  let baseColor: TslNode = uColor;
  if (textures && textures.slots.length > 0) {
    const weights = triplanarWeights(geomN);
    const height = worldPos.y;
    let acc: TslNode = vec3(0);
    let wsum: TslNode = float(0);
    let nearest: TslNode = vec3(0);
    let bestDist: TslNode = float(1e9);
    textures.slots.forEach((slot, i) => {
      const sample = triplanarAlbedo(textures.albedoArray, i, worldPos, slot.scale, weights, useTriplanar);
      const w = rangeWeight(height, slot, textures.blendBands, uBlendWidth);
      acc = acc.add(sample.mul(w));
      wsum = wsum.add(w);
      // Track the nearest band (by distance to its centre) for the out-of-band fallback.
      const center = (slot.heightMin + slot.heightMax) * 0.5;
      const dist: TslNode = abs(height.sub(center));
      const closer: TslNode = step(dist, bestDist);
      nearest = mix(nearest, sample, closer);
      bestDist = min(bestDist, dist);
    });
    // Out-of-band (terrain raised above / dug below all bands): fall back to the nearest band
    // instead of black. Matches terrain_shader.ts sampleTerrainTexture.
    let tex: TslNode = mix(nearest, acc.div(max(wsum, 0.001)), step(0.0001, wsum));
    if (textures.procedural) {
      tex = proceduralMacroTint(tex, worldPos, geomN, textures.procedural);
    }
    tex = mix(
      tex,
      paintedAlbedo(textures.albedoArray, textures.slots, worldPos, weights, paintSlots, paintWeights, useTriplanar),
      paint,
    );
    // baseColor = tex * mix(vec3(1), uColor, 0.35)  (see main.ts texturing branch)
    baseColor = tex.mul(mix(vec3(1), uColor, 0.35));
  }

  baseColor = adjustColor(baseColor, uBrightness, uContrast, uSaturation, uWarmth);

  let n: TslNode = geomN;
  if (textures?.normalArray && textures.slots.length > 0) {
    let detailN: TslNode = sampleTerrainNormal(
        textures.normalArray,
        textures.slots,
        worldPos,
        geomN,
        textures.blendBands,
        uBlendWidth,
        uNormalIntensity,
        textures.normalMapMask,
      );
    detailN = mix(
      detailN,
      paintedNormal(textures.normalArray, textures.slots, worldPos, geomN, paintSlots, paintWeights, uNormalIntensity, textures.normalMapMask),
      paint,
    );
    n = textures.procedural
      ? normalize(mix(geomN, detailN, proceduralMicroWeight(worldPos, textures.procedural)))
      : detailN;
  }

  const sun = max(dot(n, uLight), 0.0);
  const sky = clamp(n.y.mul(0.5).add(0.5), 0.0, 1.0);
  const hemi = mix(uGround, uSky, sky);
  const light = hemi.add(uSun.mul(pow(sun, 1.35)));
  const viewDir = normalize(cameraPosition.sub(worldPos));
  const halfVec = normalize(uLight.add(viewDir));
  const spec = pow(max(dot(n, halfVec), 0.0), uShininess).mul(uSpecGain).mul(sun);
  const diffuse = baseColor.mul(light);

  // Unlit material: the lighting model is computed entirely in the node graph. The renderer
  // applies tone mapping + output color space (the GLSL did this via the tonemapping/
  // colorspace chunks), so colorNode is the linear pre-tonemap colour.
  const material = new MeshBasicNodeMaterial();
  let colorNode: TslNode = diffuse.add(uSun.mul(spec));
  colorNode = normalColorOn.select(geomN.mul(0.5).add(0.5), colorNode);
  const ditherNoise = interleavedGradientNoise(screenCoordinate);
  const fade = clamp(uFade, 0.0, 1.0);
  const fadeInDiscard = ditherNoise.greaterThan(fade);
  const fadeOutDiscard = ditherNoise.lessThanEqual(fade.oneMinus());
  colorNode = colorNode.bypass(or(fadeInOn.and(fadeInDiscard), not(fadeInOn).and(fadeOutDiscard)).and(ditherOn).discard());
  material.colorNode = colorNode;
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
    setRoughness(next) {
      const clamped = Math.min(Math.max(next, 0.04), 1.0);
      uShininess.value = 128 * (1 - clamped) + 4 * clamped;
      uSpecGain.value = 1 - clamped;
    },
    setTextureParams(next) {
      uBlendWidth.value = next.blendWidth;
      uNormalIntensity.value = next.normalIntensity;
    },
    setColorAdjust(next) {
      uBrightness.value = next.brightness;
      uContrast.value = next.contrast;
      uSaturation.value = next.saturation;
      uWarmth.value = next.warmth;
    },
    setDebug(state) {
      uNormalColor.value = state.normalColor ? 1 : 0;
      void state.normalDivergence;
      void state.divergenceGain;
    },
    setFade(fade, fadeIn, dither) {
      uFade.value = fade;
      uFadeIn.value = fadeIn ? 1 : 0;
      uDither.value = dither ? 1 : 0;
    },
  };
}
