// WebGPU terrain material: TSL port of src/terrain_shader.ts.

import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  attribute,
  cameraPosition,
  clamp,
  dot,
  float,
  floor,
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
  smoothstep,
  step,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { TerrainNodeTextureSlot } from "../textures/terrainTextureArrays.js";
import type { TerrainDebugState } from "../rendering/terrain_material.js";

/** Array-texture sampling mode: disabled, single-plane, or triplanar projection. */
export type TerrainArraySamplingMode = "off" | "planar" | "triplanar";

type TslNode = any;
export type BiomeLayerSet = readonly [number, number, number];

const ROOT_HEIGHT_MORPH_ATTRIBUTE = "rootMorphDeltaY";

export interface TerrainNodeTextureProcedural {
  noiseA: THREE.Texture;
  noiseB: THREE.Texture;
  microFadeStart: number;
  microFadeEnd: number;
  lodBias: number;
}

export interface TerrainNodeTextures {
  albedoArray?: THREE.DataArrayTexture;
  normalArray?: THREE.DataArrayTexture | null;
  slots: TerrainNodeTextureSlot[];
  blendBands?: boolean;
  blendWidth?: number;
  normalIntensity?: number;
  triplanar?: boolean;
  arraySampling?: TerrainArraySamplingMode;
  normalMapMask?: readonly number[] | Float32Array;
  painted?: boolean;
  debugMode?: number;
  biomeLayerSets?: readonly BiomeLayerSet[];
  procedural?: TerrainNodeTextureProcedural | null;
  riverWetnessMask?: THREE.Texture | null;
  bakedMacroTint?: THREE.Texture | null;
  worldSize?: number;
}

export interface TerrainNodeMaterialOptions {
  lighting?: TerrainNodeLighting;
  adjust?: TerrainColorAdjust;
  textures?: TerrainNodeTextures | null;
}

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
  setLighting(next: Partial<TerrainNodeLighting>): void;
  setColorAdjust(next: Partial<TerrainColorAdjust>): void;
  setNormalColor(on: boolean): void;
  setFade(fade: number, fadeIn: boolean, dither: boolean): void;
  setRootMorph(influence: number): void;
  setTier(tier: number): void;
  setDebug(state: TerrainDebugState): void;
  setRoughness(roughness: number): void;
  setTextureParams(params: { blendWidth?: number; normalIntensity?: number }): void;
}

export interface TerrainNodeLighting {
  lightDir: THREE.Vector3;
  sunColor: THREE.Color;
  skyLight: THREE.Color;
  groundLight: THREE.Color;
  baseColor: THREE.Color;
  roughness: number;
}

export interface TerrainColorAdjust {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
}

function v3(c: THREE.Color): THREE.Vector3 { return new THREE.Vector3(c.r, c.g, c.b); }

function interleavedGradientNoise(coord: TslNode): TslNode {
  return fract(coord.x.mul(0.06711056).add(coord.y.mul(0.00583715)).mul(52.9829189));
}

function adjustColor(color: TslNode, brightness: TslNode, contrast: TslNode, saturation: TslNode, warmth: TslNode): TslNode {
  let c = color.mul(brightness);
  c = c.sub(0.5).mul(contrast).add(0.5);
  const lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(lum), c, saturation);
  const warm = vec3(1.0, 0.93, 0.84);
  const cool = vec3(0.86, 0.93, 1.0);
  c = c.mul(mix(cool, warm, warmth.mul(0.5).add(0.5)));
  return clamp(c, 0.0, 10.0);
}

function triplanarWeights(n: TslNode): TslNode {
  const w: TslNode = pow(abs(n) as TslNode, vec3(4.0) as TslNode);
  const s = w.x.add(w.y).add(w.z);
  return w.div(max(s, 0.0001));
}

function roundedLayer(layer: TslNode): TslNode {
  return floor(max(layer, 0.0).add(0.5));
}

function heightBandWeight(
  heightMin: number,
  heightMax: number,
  height: TslNode,
  blendWidth: TslNode,
): TslNode {
  const minEdge = float(heightMin);
  const maxEdge = float(heightMax);
  return smoothstep(minEdge.sub(blendWidth), minEdge.add(blendWidth), height)
    .mul(float(1).sub(smoothstep(maxEdge.sub(blendWidth), maxEdge.add(blendWidth), height)));
}

function sampleArray(tex: THREE.DataArrayTexture, uv: TslNode, layer: TslNode): TslNode {
  // DataArrayTexture must be sampled with a vec2 uv + `.depth(layer)`; passing the layer as the
  // z of a vec3 makes three slice the coord to `.xy` and emit an array sample with no array_index
  // (invalid WGSL). Round the layer so interpolated/attribute-driven indices don't jitter between
  // adjacent layers (screen-door speckle).
  return texture(tex, vec2(fract(uv.x), fract(uv.y))).depth(roundedLayer(layer));
}

function layerScale(layer: TslNode, slots: readonly TerrainNodeTextureSlot[]): TslNode {
  let scale: TslNode = float(slots[0]?.scale ?? 1 / 64);
  for (let i = 1; i < slots.length; i++) {
    scale = mix(scale, float(slots[i].scale), step(abs(roundedLayer(layer).sub(i)), 0.5));
  }
  return scale;
}

function layerHeightMin(layer: TslNode, slots: readonly TerrainNodeTextureSlot[]): TslNode {
  let value: TslNode = float(slots[0]?.heightMin ?? 0);
  for (let i = 1; i < slots.length; i++) {
    value = mix(value, float(slots[i].heightMin), step(abs(roundedLayer(layer).sub(i)), 0.5));
  }
  return value;
}

function layerHeightMax(layer: TslNode, slots: readonly TerrainNodeTextureSlot[]): TslNode {
  let value: TslNode = float(slots[0]?.heightMax ?? 0);
  for (let i = 1; i < slots.length; i++) {
    value = mix(value, float(slots[i].heightMax), step(abs(roundedLayer(layer).sub(i)), 0.5));
  }
  return value;
}

function layerHeightCenter(layer: TslNode, slots: readonly TerrainNodeTextureSlot[]): TslNode {
  return layerHeightMin(layer, slots).add(layerHeightMax(layer, slots)).mul(0.5);
}

function layerHeightBandWeight(
  layer: TslNode,
  slots: readonly TerrainNodeTextureSlot[],
  height: TslNode,
  blendWidth: TslNode,
): TslNode {
  const minEdge = layerHeightMin(layer, slots);
  const maxEdge = layerHeightMax(layer, slots);
  return smoothstep(minEdge.sub(blendWidth), minEdge.add(blendWidth), height)
    .mul(float(1).sub(smoothstep(maxEdge.sub(blendWidth), maxEdge.add(blendWidth), height)));
}

function layerNormalMask(layer: TslNode, normalMapMask?: readonly number[] | Float32Array): TslNode {
  let mask: TslNode = float(normalMapMask?.[0] ?? 1);
  for (let i = 1; i < (normalMapMask?.length ?? 0); i++) {
    mask = mix(mask, float(normalMapMask?.[i] ?? 1), step(abs(roundedLayer(layer).sub(i)), 0.5));
  }
  return mask;
}

function triplanarAlbedo(
  tex: THREE.DataArrayTexture,
  layer: TslNode,
  worldPos: TslNode,
  scale: TslNode,
  weights: TslNode,
  useTriplanar: boolean,
): TslNode {
  const uvX = worldPos.zy.mul(scale);
  const uvY = worldPos.xz.mul(scale);
  const uvZ = worldPos.xy.mul(scale);
  const y = sampleArray(tex, uvY, layer).rgb;
  if (!useTriplanar) return y;
  const x = sampleArray(tex, uvX, layer).rgb;
  const z = sampleArray(tex, uvZ, layer).rgb;
  return x.mul(weights.x).add(y.mul(weights.y)).add(z.mul(weights.z));
}

function normalUnpack(sample: TslNode, strength: TslNode): TslNode {
  const n = sample.xyz.mul(2.0).sub(1.0);
  return normalize(vec3(n.x.mul(strength), n.y.mul(strength), n.z));
}

function triplanarNormal(
  tex: THREE.DataArrayTexture,
  layer: TslNode,
  worldPos: TslNode,
  baseNormal: TslNode,
  scale: TslNode,
  weights: TslNode,
  strength: TslNode,
  useMask: TslNode,
): TslNode {
  const uvX = worldPos.zy.mul(scale);
  const uvY = worldPos.xz.mul(scale);
  const uvZ = worldPos.xy.mul(scale);
  const nx = normalUnpack(sampleArray(tex, uvX, layer), strength);
  const ny = normalUnpack(sampleArray(tex, uvY, layer), strength);
  const nz = normalUnpack(sampleArray(tex, uvZ, layer), strength);
  const blended = normalize(nx.mul(weights.x).add(ny.mul(weights.y)).add(nz.mul(weights.z)));
  return mix(baseNormal, blended, useMask);
}

function sampleTerrainTexture(
  tex: THREE.DataArrayTexture,
  slots: readonly TerrainNodeTextureSlot[],
  worldPos: TslNode,
  normal: TslNode,
  height: TslNode,
  blendWidth: TslNode,
  useTriplanar: boolean,
): TslNode {
  const weights = triplanarWeights(normal);
  let acc: TslNode = vec3(0);
  let wsum: TslNode = float(0);
  let nearest: TslNode = vec3(1);
  let bestDist: TslNode = float(1e9);
  slots.forEach((slot, i) => {
    const layer = float(i);
    const sample = triplanarAlbedo(tex, layer, worldPos, float(slot.scale), weights, useTriplanar);
    const w = heightBandWeight(slot.heightMin, slot.heightMax, height, blendWidth);
    acc = acc.add(sample.mul(w));
    wsum = wsum.add(w);
    const center = (slot.heightMin + slot.heightMax) * 0.5;
    const dist: TslNode = abs(height.sub(float(center)));
    const closer: TslNode = step(dist, bestDist);
    nearest = mix(nearest, sample, closer);
    bestDist = min(bestDist, dist);
  });
  return mix(nearest, acc.div(max(wsum, 0.001)), step(0.0001, wsum));
}

function sampleTerrainNormal(
  tex: THREE.DataArrayTexture,
  slots: readonly TerrainNodeTextureSlot[],
  worldPos: TslNode,
  normal: TslNode,
  height: TslNode,
  blendWidth: TslNode,
  intensity: TslNode,
  normalMapMask?: readonly number[] | Float32Array,
): TslNode {
  const weights = triplanarWeights(normal);
  let acc: TslNode = vec3(0);
  let wsum: TslNode = float(0);
  let nearest: TslNode = normal;
  let bestDist: TslNode = float(1e9);
  slots.forEach((slot, i) => {
    const layer = float(i);
    const useMask = float(normalMapMask?.[i] ?? 1);
    const sample = triplanarNormal(tex, layer, worldPos, normal, float(slot.scale), weights, intensity, useMask);
    const w = heightBandWeight(slot.heightMin, slot.heightMax, height, blendWidth);
    acc = acc.add(sample.mul(w));
    wsum = wsum.add(w);
    const center = (slot.heightMin + slot.heightMax) * 0.5;
    const dist: TslNode = abs(height.sub(float(center)));
    const closer: TslNode = step(dist, bestDist);
    nearest = mix(nearest, sample, closer);
    bestDist = min(bestDist, dist);
  });
  const blended: TslNode = mix(nearest, acc.div(max(wsum, 0.001)), step(0.0001, wsum));
  return normalize(blended);
}

function biomeLayer(biome: TslNode, sets: readonly BiomeLayerSet[], channel: 0 | 1 | 2): TslNode {
  let layer: TslNode = float(sets[0]?.[channel] ?? 0);
  for (let i = 1; i < sets.length; i++) {
    layer = mix(layer, float(sets[i]?.[channel] ?? 0), step(abs(biome.sub(i)), 0.5));
  }
  return roundedLayer(layer);
}

function sampleBiomeTerrainTexture(
  tex: THREE.DataArrayTexture,
  slots: readonly TerrainNodeTextureSlot[],
  biomeLayerSets: readonly BiomeLayerSet[],
  worldPos: TslNode,
  normal: TslNode,
  biomeId: TslNode,
  blendWidth: TslNode,
  useTriplanar: boolean,
): TslNode {
  const weights = triplanarWeights(normal);
  const biome = roundedLayer(biomeId);
  const lowLayer = biomeLayer(biome, biomeLayerSets, 0);
  const midLayer = biomeLayer(biome, biomeLayerSets, 1);
  const highLayer = biomeLayer(biome, biomeLayerSets, 2);
  const low = triplanarAlbedo(tex, lowLayer, worldPos, layerScale(lowLayer, slots), weights, useTriplanar);
  const mid = triplanarAlbedo(tex, midLayer, worldPos, layerScale(midLayer, slots), weights, useTriplanar);
  const high = triplanarAlbedo(tex, highLayer, worldPos, layerScale(highLayer, slots), weights, useTriplanar);
  const lowWeight = layerHeightBandWeight(lowLayer, slots, worldPos.y, blendWidth);
  const midWeight = layerHeightBandWeight(midLayer, slots, worldPos.y, blendWidth);
  const highWeight = layerHeightBandWeight(highLayer, slots, worldPos.y, blendWidth);
  const acc = low.mul(lowWeight).add(mid.mul(midWeight)).add(high.mul(highWeight));
  const wsum = lowWeight.add(midWeight).add(highWeight);

  let nearest: TslNode = low;
  let bestDist: TslNode = abs(worldPos.y.sub(layerHeightCenter(lowLayer, slots)));
  const midDist: TslNode = abs(worldPos.y.sub(layerHeightCenter(midLayer, slots)));
  const midCloser: TslNode = step(midDist, bestDist);
  nearest = mix(nearest, mid, midCloser);
  bestDist = min(bestDist, midDist);
  const highDist: TslNode = abs(worldPos.y.sub(layerHeightCenter(highLayer, slots)));
  nearest = mix(nearest, high, step(highDist, bestDist));

  return mix(nearest, acc.div(max(wsum, 0.001)), step(0.0001, wsum));
}

function sampleBiomeTerrainNormal(
  tex: THREE.DataArrayTexture,
  slots: readonly TerrainNodeTextureSlot[],
  biomeLayerSets: readonly BiomeLayerSet[],
  worldPos: TslNode,
  baseNormal: TslNode,
  biomeId: TslNode,
  blendWidth: TslNode,
  normalIntensity: TslNode,
  normalMapMask?: readonly number[] | Float32Array,
): TslNode {
  const weights = triplanarWeights(baseNormal);
  const biome = roundedLayer(biomeId);
  const lowLayer = biomeLayer(biome, biomeLayerSets, 0);
  const midLayer = biomeLayer(biome, biomeLayerSets, 1);
  const highLayer = biomeLayer(biome, biomeLayerSets, 2);
  const low = triplanarNormal(tex, lowLayer, worldPos, baseNormal, layerScale(lowLayer, slots), weights, normalIntensity, layerNormalMask(lowLayer, normalMapMask));
  const mid = triplanarNormal(tex, midLayer, worldPos, baseNormal, layerScale(midLayer, slots), weights, normalIntensity, layerNormalMask(midLayer, normalMapMask));
  const high = triplanarNormal(tex, highLayer, worldPos, baseNormal, layerScale(highLayer, slots), weights, normalIntensity, layerNormalMask(highLayer, normalMapMask));
  const lowWeight = layerHeightBandWeight(lowLayer, slots, worldPos.y, blendWidth);
  const midWeight = layerHeightBandWeight(midLayer, slots, worldPos.y, blendWidth);
  const highWeight = layerHeightBandWeight(highLayer, slots, worldPos.y, blendWidth);
  const acc = low.mul(lowWeight).add(mid.mul(midWeight)).add(high.mul(highWeight));
  const wsum = lowWeight.add(midWeight).add(highWeight);

  let nearest: TslNode = low;
  let bestDist: TslNode = abs(worldPos.y.sub(layerHeightCenter(lowLayer, slots)));
  const midDist: TslNode = abs(worldPos.y.sub(layerHeightCenter(midLayer, slots)));
  const midCloser: TslNode = step(midDist, bestDist);
  nearest = mix(nearest, mid, midCloser);
  bestDist = min(bestDist, midDist);
  const highDist: TslNode = abs(worldPos.y.sub(layerHeightCenter(highLayer, slots)));
  nearest = mix(nearest, high, step(highDist, bestDist));

  return normalize(mix(nearest, acc.div(max(wsum, 0.001)), step(0.0001, wsum)));
}

function paintedAlbedo(
  albedo: THREE.DataArrayTexture,
  slots: readonly TerrainNodeTextureSlot[],
  worldPos: TslNode,
  paintSlots: TslNode,
  paintWeights: TslNode,
  weights: TslNode,
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
    const layer = roundedLayer(channel.slot);
    const w = channel.weight.mul(step(0.0, channel.slot.add(0.5)));
    acc = acc.add(triplanarAlbedo(albedo, layer, worldPos, layerScale(layer, slots), weights, useTriplanar).mul(w));
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
  const weights = triplanarWeights(baseNormal);
  let acc: TslNode = vec3(0);
  let wsum: TslNode = float(0);
  for (const channel of channels) {
    const layer = roundedLayer(channel.slot);
    const w = channel.weight.mul(step(0.0, channel.slot.add(0.5)));
    acc = acc.add(triplanarNormal(normalArray, layer, worldPos, baseNormal, layerScale(layer, slots), weights, normalIntensity, layerNormalMask(layer, normalMapMask)).mul(w));
    wsum = wsum.add(w);
  }
  return normalize(acc.div(max(wsum, 0.001)));
}

function proceduralMacroTint(base: TslNode, worldPos: TslNode, normal: TslNode, procedural: TerrainNodeTextureProcedural): TslNode {
  const uvA = worldPos.xz.mul(1 / 256);
  const uvB = worldPos.xz.mul(1 / 96).add(vec2(0.37, 0.11));
  const a = texture(procedural.noiseA, uvA).rgba;
  const b = texture(procedural.noiseB, uvB).rgba;
  const macroMix = a.r.mul(0.65).add(a.g.mul(0.35));
  let tinted = base.mul(vec3(1.0).add(vec3(0.30, 0.34, 0.22).mul(macroMix.sub(0.5)).mul(0.16)));
  const mossFactor = smoothstep(float(0.58), float(0.86), b.a)
    .mul(smoothstep(float(0.28), float(0.72), float(1).sub(normal.y)))
    .mul(float(0.28));
  tinted = mix(tinted, tinted.mul(vec3(0.45, 0.62, 0.34)), mossFactor);
  const wet = smoothstep(float(0.04), float(0.0), worldPos.y.sub(float(18.0))).mul(float(0.38));
  tinted = mix(tinted, tinted.mul(vec3(0.64, 0.68, 0.72)), wet);
  return tinted;
}

function proceduralMicroWeight(worldPos: TslNode, procedural: TerrainNodeTextureProcedural): TslNode {
  const uv = worldPos.xz.mul(1 / 96).add(vec2(0.17, 0.29));
  const n = texture(procedural.noiseB, uv).r;
  const dist = cameraPosition.sub(worldPos).length();
  const fade = float(1).sub(smoothstep(float(procedural.microFadeStart), float(procedural.microFadeEnd), dist));
  return n.mul(fade).mul(float(0.45));
}

function roughnessToShininess(roughness: number): number {
  const rough = Math.min(Math.max(roughness, 0.04), 1.0);
  return 128 * (1 - rough) + 4 * rough;
}

export function createTerrainNodeMaterial(
  options: TerrainNodeMaterialOptions = {},
): TerrainNodeMaterialHandle {
  const lighting = options.lighting ?? DEFAULT_TERRAIN_NODE_LIGHTING;
  const adjust = options.adjust ?? DEFAULT_TERRAIN_COLOR_ADJUST;
  const textures = options.textures ?? null;
  const arraySampling = textures?.arraySampling ?? "triplanar";
  const useArrayTextures = arraySampling !== "off";
  const useTriplanar = arraySampling === "triplanar" && (textures?.triplanar ?? true);
  const useBiomeLayers = Boolean(textures?.biomeLayerSets?.length);

  const uLight = uniform(lighting.lightDir.clone());
  const uSun = uniform(v3(lighting.sunColor));
  const uSky = uniform(v3(lighting.skyLight));
  const uGround = uniform(v3(lighting.groundLight));
  const uColor = uniform(v3(lighting.baseColor));
  const uBrightness = uniform(adjust.brightness);
  const uContrast = uniform(adjust.contrast);
  const uSaturation = uniform(adjust.saturation);
  const uWarmth = uniform(adjust.warmth);
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
  const uShininess = uniform(roughnessToShininess(rough));
  const uSpecGain = uniform(1 - rough);
  const uTier = uniform(0);
  const uRootMorphInfluence = uniform(0.0);

  const geomN = normalize(normalGeometry);
  const rootMorphDeltaY: TslNode = attribute(ROOT_HEIGHT_MORPH_ATTRIBUTE, "float");
  // CLOD page vertices are stored in absolute world coordinates and render-node meshes remain at
  // the identity transform. Root morph only adjusts Y, so this is the authoritative world sample.
  const worldPos = positionGeometry.add(vec3(0.0, rootMorphDeltaY.mul(uRootMorphInfluence), 0.0));
  const paintSlots: TslNode = attribute("paintSlots", "vec4");
  const paintWeights: TslNode = attribute("paintWeights", "vec4");
  const biomeId: TslNode = attribute("biomeId", "float");
  const paint = clamp(dot(paintWeights, vec4(1)), 0.0, 1.0);
  const isFarTier = step(float(1.5), uTier);

  let baseColor: TslNode = vec3(0.35, 0.45, 0.22);
  if (textures?.albedoArray && textures.slots.length > 0 && useArrayTextures) {
    const weights = triplanarWeights(geomN);
    let tex: TslNode = useBiomeLayers
      ? sampleBiomeTerrainTexture(textures.albedoArray, textures.slots, textures.biomeLayerSets!, worldPos, geomN, biomeId, uBlendWidth, useTriplanar)
      : sampleTerrainTexture(textures.albedoArray, textures.slots, worldPos, geomN, worldPos.y, uBlendWidth, useTriplanar);
    if (textures.procedural) tex = proceduralMacroTint(tex, worldPos, geomN, textures.procedural);
    if (textures.bakedMacroTint) {
      const ws = float(textures.worldSize ?? 1024);
      const baked = texture(textures.bakedMacroTint, worldPos.xz.div(ws)).rgb;
      tex = isFarTier.select(baked, tex);
    }
    if (textures.painted) {
      tex = mix(tex, paintedAlbedo(textures.albedoArray, textures.slots, worldPos, paintSlots, paintWeights, weights, useTriplanar), paint);
    }
    baseColor = tex.mul(mix(vec3(1), uColor, float(0.35)));
  }

  let riverWetness: TslNode = float(0);
  let riverFoamResidue: TslNode = float(0);
  let riverDroplets: TslNode = float(0);
  if (textures?.riverWetnessMask) {
    const ws = float(textures.worldSize ?? 1024);
    const mask: TslNode = texture(textures.riverWetnessMask, worldPos.xz.div(ws));
    const slopeFade: TslNode = smoothstep(float(0.34), float(0.82), geomN.y);
    riverWetness = clamp(mask.r.mul(slopeFade), 0.0, 1.0);
    riverFoamResidue = clamp(mask.g.mul(slopeFade), 0.0, 1.0);
    riverDroplets = clamp(mask.b.mul(slopeFade), 0.0, 1.0);
    const wetTotal = clamp(riverWetness.add(riverDroplets.mul(0.9)), 0.0, 1.0);
    baseColor = mix(baseColor, baseColor.mul(vec3(0.44, 0.50, 0.48)), wetTotal.mul(0.72));
    baseColor = mix(baseColor, baseColor.mul(vec3(0.32, 0.38, 0.40)), riverDroplets.mul(0.74));
    baseColor = mix(baseColor, vec3(0.72, 0.78, 0.74), riverFoamResidue.mul(0.36));
  }

  baseColor = adjustColor(baseColor, uBrightness, uContrast, uSaturation, uWarmth);

  let n: TslNode = geomN;
  if (textures?.normalArray && textures.slots.length > 0 && useArrayTextures) {
    const normalWeight = isFarTier.select(0.0, 1.0);
    let detailN: TslNode = useBiomeLayers
      ? sampleBiomeTerrainNormal(textures.normalArray, textures.slots, textures.biomeLayerSets!, worldPos, geomN, biomeId, uBlendWidth, uNormalIntensity, textures.normalMapMask)
      : sampleTerrainNormal(textures.normalArray, textures.slots, worldPos, geomN, worldPos.y, uBlendWidth, uNormalIntensity, textures.normalMapMask);
    if (textures.painted) {
      detailN = mix(detailN, paintedNormal(textures.normalArray, textures.slots, worldPos, geomN, paintSlots, paintWeights, uNormalIntensity, textures.normalMapMask), paint);
    }
    const computedN = textures.procedural ? normalize(mix(geomN, detailN, proceduralMicroWeight(worldPos, textures.procedural))) : detailN;
    n = mix(geomN, computedN, normalWeight);
  }

  const sun = max(dot(n, uLight), 0.0);
  const sky = clamp(n.y.mul(0.5).add(0.5), 0.0, 1.0);
  const hemi = mix(uGround, uSky, sky);
  const light = hemi.add(uSun.mul(pow(sun, 1.35)));
  const viewDir = normalize(cameraPosition.sub(worldPos));
  const halfVec = normalize(uLight.add(viewDir));
  const wetGloss = clamp(riverWetness.mul(0.45).add(riverDroplets.mul(1.0)), 0.0, 1.0);
  const spec = pow(max(dot(n, halfVec), 0.0), uShininess)
    .mul(uSpecGain.mul(float(1).add(wetGloss.mul(2.4))))
    .mul(sun);

  const material = new MeshBasicNodeMaterial();
  let colorNode: TslNode = baseColor.mul(light).add(uSun.mul(spec));
  colorNode = normalColorOn.select(geomN.mul(0.5).add(0.5), colorNode);
  const debugMode = textures?.debugMode ?? 0;
  if (debugMode === 2) {
    colorNode = vec3(paint);
  } else if (debugMode === 3) {
    colorNode = vec3(max(paintSlots.x, 0.0), max(paintSlots.y, 0.0), max(paintSlots.z, 0.0)).div(8.0);
  } else if (debugMode === 8) {
    colorNode = vec3(riverWetness);
  } else if (debugMode === 9) {
    colorNode = vec3(riverFoamResidue);
  } else if (debugMode === 10) {
    colorNode = vec3(riverDroplets);
  } else if (debugMode === 11) {
    const id = roundedLayer(biomeId);
    let biomeColor: TslNode = vec3(0.30, 0.38, 0.21);
    biomeColor = mix(biomeColor, vec3(0.18, 0.31, 0.14), step(abs(id.sub(1.0)), 0.5));
    biomeColor = mix(biomeColor, vec3(0.19, 0.28, 0.20), step(abs(id.sub(2.0)), 0.5));
    biomeColor = mix(biomeColor, vec3(0.42, 0.40, 0.36), step(abs(id.sub(3.0)), 0.5));
    biomeColor = mix(biomeColor, vec3(0.47, 0.43, 0.25), step(abs(id.sub(4.0)), 0.5));
    biomeColor = mix(biomeColor, vec3(0.64, 0.55, 0.34), step(abs(id.sub(5.0)), 0.5));
    biomeColor = mix(biomeColor, vec3(0.10, 0.20, 0.30), step(abs(id.sub(6.0)), 0.5));
    colorNode = biomeColor;
  }
  const ditherNoise = interleavedGradientNoise(screenCoordinate);
  const fade = clamp(uFade, 0.0, 1.0);
  const fadeInDiscard = ditherNoise.greaterThan(fade);
  const fadeOutDiscard = ditherNoise.lessThanEqual(fade.oneMinus());
  colorNode = colorNode.bypass(or(fadeInOn.and(fadeInDiscard), not(fadeInOn).and(fadeOutDiscard)).and(ditherOn).discard());
  material.positionNode = worldPos;
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
      if (next.roughness !== undefined) this.setRoughness(next.roughness);
    },
    setColorAdjust(next) {
      if (next.brightness !== undefined) uBrightness.value = next.brightness;
      if (next.contrast !== undefined) uContrast.value = next.contrast;
      if (next.saturation !== undefined) uSaturation.value = next.saturation;
      if (next.warmth !== undefined) uWarmth.value = next.warmth;
    },
    setNormalColor(on) { uNormalColor.value = on ? 1 : 0; },
    setDebug(state) { uNormalColor.value = state.normalColor ? 1 : 0; },
    setFade(fadeValue, fadeIn, dither) {
      uFade.value = fadeValue;
      uFadeIn.value = fadeIn ? 1 : 0;
      uDither.value = dither ? 1 : 0;
    },
    setRootMorph(influence) {
      uRootMorphInfluence.value = THREE.MathUtils.clamp(influence, 0, 1);
    },
    setTier(tier) { uTier.value = tier; },
    setRoughness(roughness) {
      const clamped = Math.min(Math.max(roughness, 0.04), 1.0);
      uShininess.value = roughnessToShininess(clamped);
      uSpecGain.value = 1 - clamped;
    },
    setTextureParams(params) {
      if (params.blendWidth !== undefined) uBlendWidth.value = params.blendWidth;
      if (params.normalIntensity !== undefined) uNormalIntensity.value = params.normalIntensity;
    },
  };
}

export { createBakedMacroTintTexture } from "./terrain_node_baked_macro_tint.js";
