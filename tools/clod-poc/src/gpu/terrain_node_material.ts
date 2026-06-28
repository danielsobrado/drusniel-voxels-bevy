// Phase 2 WebGPU terrain material (docs/webgpu-migration.md). TSL port of src/terrain_shader.ts.

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
  sign,
  smoothstep,
  step,
  sub,
  texture,
  textureSize,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { TerrainNodeTextureSlot } from "../textures/terrainTextureArrays.js";
import type { TerrainArraySamplingMode } from "../terrain/material/terrain_texture_controller.js";

type TslNode = any;

export interface TerrainNodeTextureProcedural {
  noiseA: THREE.Texture;
  noiseB: THREE.Texture;
  microFadeStart: number;
  microFadeEnd: number;
  lodBias: number;
}

export interface TerrainNodeTextures {
  albedoArray?: THREE.DataArrayTexture;
  normalArray?: THREE.DataArrayTexture;
  slots: TerrainNodeTextureSlot[];
  blendWidth?: number;
  normalIntensity?: number;
  triplanar?: boolean;
  arraySampling?: TerrainArraySamplingMode;
  normalMapMask?: readonly number[] | Float32Array;
  painted?: boolean;
  debugMode?: number;
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
  setColorAdjust?(next: Partial<TerrainColorAdjust>): void;
  setNormalColor?(on: boolean): void;
  setFade?(fade: number, fadeIn: boolean, dither: boolean): void;
  setTier?(tier: number): void;
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

function v3(c: THREE.Color): TslNode { return vec3(c.r, c.g, c.b); }

function hash2(p: TslNode): TslNode {
  const zero = sign(sub(p.x, p.x)).mul(0.0);
  return fract(p.dot(vec2(127.1, 311.7)).sin().mul(43758.5453123).add(zero));
}

function interleavedGradientNoise(coord: TslNode): TslNode {
  return fract(coord.x.mul(0.06711056).add(coord.y.mul(0.00583715)).mul(52.9829189))
    .add(hash2(coord).mul(0.0));
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
  const w = pow(abs(n), vec3(4.0));
  const s = w.x.add(w.y).add(w.z);
  return w.div(max(s, 0.0001));
}

function sampleArray(tex: THREE.DataArrayTexture, uv: TslNode, layer: TslNode): TslNode {
  return texture(tex, vec3(fract(uv.x), fract(uv.y), layer));
}

function safeTextureSize(tex: THREE.DataArrayTexture): [number, number, number] {
  void textureSize;
  const image = tex.image as { width?: number; height?: number; depth?: number } | undefined;
  return [image?.width ?? 1, image?.height ?? 1, image?.depth ?? 1];
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
    const w = smoothstep(slot.heightMin - blendWidth, slot.heightMin + blendWidth, height)
      .mul(float(1).sub(smoothstep(slot.heightMax - blendWidth, slot.heightMax + blendWidth, height)));
    acc = acc.add(sample.mul(w));
    wsum = wsum.add(w);
    const center = (slot.heightMin + slot.heightMax) * 0.5;
    const dist: TslNode = abs(height.sub(center));
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
    const w = smoothstep(slot.heightMin - blendWidth, slot.heightMin + blendWidth, height)
      .mul(float(1).sub(smoothstep(slot.heightMax - blendWidth, slot.heightMax + blendWidth, height)));
    acc = acc.add(sample.mul(w));
    wsum = wsum.add(w);
    const center = (slot.heightMin + slot.heightMax) * 0.5;
    const dist: TslNode = abs(height.sub(center));
    const closer: TslNode = step(dist, bestDist);
    nearest = mix(nearest, sample, closer);
    bestDist = min(bestDist, dist);
  });
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
    const layer = floor(max(channel.slot, 0.0).add(0.5));
    let scale: TslNode = float(slots[0].scale);
    for (let i = 1; i < slots.length; i++) {
      scale = mix(scale, float(slots[i].scale), step(abs(layer.sub(i)), 0.5));
    }
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
    const layer = floor(max(channel.slot, 0.0).add(0.5));
    let scale: TslNode = float(slots[0].scale);
    for (let i = 1; i < slots.length; i++) {
      scale = mix(scale, float(slots[i].scale), step(abs(layer.sub(i)), 0.5));
    }
    const w = channel.weight.mul(step(0.0, channel.slot.add(0.5)));
    acc = acc.add(triplanarNormal(normalArray, layer, worldPos, baseNormal, scale, triplanarWeights(baseNormal), normalIntensity, float(normalMapMask?.[0] ?? 1)).mul(w));
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
  const mossFactor = smoothstep(0.58, 0.86, b.a).mul(smoothstep(0.28, 0.72, float(1).sub(normal.y))).mul(0.28);
  tinted = mix(tinted, tinted.mul(vec3(0.45, 0.62, 0.34)), mossFactor);
  const wet = smoothstep(0.04, 0.0, worldPos.y.sub(18.0)).mul(0.38);
  tinted = mix(tinted, tinted.mul(vec3(0.64, 0.68, 0.72)), wet);
  return tinted;
}

function proceduralMicroWeight(worldPos: TslNode, procedural: TerrainNodeTextureProcedural): TslNode {
  const uv = worldPos.xz.mul(1 / 96).add(vec2(0.17, 0.29));
  const n = texture(procedural.noiseB, uv).r;
  const dist = cameraPosition.sub(worldPos).length();
  const fade = float(1).sub(smoothstep(procedural.microFadeStart, procedural.microFadeEnd, dist));
  return n.mul(fade).mul(0.45);
}

function createBakedMacroTintTexture(noiseA: THREE.Texture, noiseB: THREE.Texture, res = 256): THREE.DataTexture {
  const imgA = noiseA.image as { data?: Uint8Array; width?: number; height?: number } | undefined;
  const imgB = noiseB.image as { data?: Uint8Array; width?: number; height?: number } | undefined;
  const srcA = imgA?.data;
  const srcB = imgB?.data;
  const srcRes = imgA?.width ?? 0;
  if (!srcA || !srcB || srcRes <= 0 || imgB?.width !== srcRes) {
    const fallback = new Uint8Array(res * res * 4);
    fallback.fill(255);
    return new THREE.DataTexture(fallback, res, res, THREE.RGBAFormat, THREE.UnsignedByteType);
  }
  const out = new Uint8Array(res * res * 4);
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const smoothstepF = (e0: number, e1: number, x: number) => {
    const t = clamp01((x - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
  };
  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      const u = x / res;
      const v = z / res;
      const ax = Math.floor(u * srcRes) % srcRes;
      const az = Math.floor(v * srcRes) % srcRes;
      const ai = (az * srcRes + ax) * 4;
      const value = srcA[ai] / 255;
      const fbm = srcA[ai + 1] / 255;
      const bx = Math.floor(((u * (256 / 96)) + 0.37) * srcRes) % srcRes;
      const bz = Math.floor(((v * (256 / 96)) + 0.11) * srcRes) % srcRes;
      const bi = (bz * srcRes + bx) * 4;
      const worley = srcB[bi + 3] / 255;
      const macroMix = value * 0.65 + fbm * 0.35;
      const baseR = 0.30 * (macroMix - 0.5) * 0.16 + 1.0;
      const baseG = 0.34 * (macroMix - 0.5) * 0.16 + 1.0;
      const baseB = 0.22 * (macroMix - 0.5) * 0.16 + 1.0;
      const mossFactor = smoothstepF(0.58, 0.86, worley) * smoothstepF(0.28, 0.72, 0.3) * 0.28;
      let r = baseR * (1 - mossFactor) + 0.11 * mossFactor;
      let g = baseG * (1 - mossFactor) + 0.19 * mossFactor;
      let b = baseB * (1 - mossFactor) + 0.07 * mossFactor;
      const wetFactor = smoothstepF(0.04, 0.0, 0) * 0.38;
      r = r * (1 - wetFactor) + r * 0.64 * wetFactor;
      g = g * (1 - wetFactor) + g * 0.68 * wetFactor;
      b = b * (1 - wetFactor) + b * 0.72 * wetFactor;
      const oi = (z * res + x) * 4;
      out[oi] = Math.round(clamp01(r) * 255);
      out[oi + 1] = Math.round(clamp01(g) * 255);
      out[oi + 2] = Math.round(clamp01(b) * 255);
      out[oi + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(out, res, res, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function createTerrainNodeMaterial(
  options: TerrainNodeMaterialOptions = {},
): TerrainNodeMaterialHandle {
  const lighting = options.lighting ?? DEFAULT_TERRAIN_NODE_LIGHTING;
  const adjust = options.adjust ?? DEFAULT_TERRAIN_COLOR_ADJUST;
  const textures = options.textures ?? null;
  if (textures?.albedoArray) safeTextureSize(textures.albedoArray);
  const arraySampling = textures?.arraySampling ?? "triplanar";
  const useArrayTextures = arraySampling !== "off";
  const useTriplanar = arraySampling === "triplanar" && (textures?.triplanar ?? true);

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
  const uShininess = uniform(128 * (1 - rough) + 4 * rough);
  const uSpecGain = uniform(1 - rough);
  const uTier = uniform(0);

  const geomN = normalize(normalGeometry);
  const worldPos = positionGeometry;
  const paintSlots: TslNode = attribute("paintSlots", "vec4");
  const paintWeights: TslNode = attribute("paintWeights", "vec4");
  const biomeId: TslNode = attribute("biomeId", "float");
  const paint = clamp(dot(paintWeights, vec4(1)), 0.0, 1.0);
  const isFarTier = step(1.5, uTier);

  let baseColor: TslNode = vec3(0.35, 0.45, 0.22);
  if (textures?.albedoArray && textures.slots.length > 0 && useArrayTextures) {
    const weights = triplanarWeights(geomN);
    let tex: TslNode = sampleTerrainTexture(textures.albedoArray, textures.slots, worldPos, geomN, worldPos.y, uBlendWidth, useTriplanar);
    if (textures.procedural) tex = proceduralMacroTint(tex, worldPos, geomN, textures.procedural);
    if (textures.bakedMacroTint) {
      const ws = textures.worldSize ?? 1024;
      const baked = texture(textures.bakedMacroTint, worldPos.xz.div(ws));
      tex = isFarTier.select(baked, tex);
    }
    if (textures.painted) {
      tex = mix(tex, paintedAlbedo(textures.albedoArray, textures.slots, worldPos, paintSlots, paintWeights, weights, useTriplanar), paint);
    }
    baseColor = tex.mul(mix(vec3(1), uColor, 0.35));
  }

  let riverWetness: TslNode = float(0);
  let riverFoamResidue: TslNode = float(0);
  let riverDroplets: TslNode = float(0);
  if (textures?.riverWetnessMask) {
    const ws = textures.worldSize ?? 1024;
    const mask: TslNode = texture(textures.riverWetnessMask, worldPos.xz.div(ws));
    const slopeFade: TslNode = smoothstep(0.34, 0.82, geomN.y);
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
    let detailN: TslNode = sampleTerrainNormal(textures.normalArray, textures.slots, worldPos, geomN, worldPos.y, uBlendWidth, uNormalIntensity, textures.normalMapMask);
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
    const id = floor(max(biomeId, 0.0).add(0.5));
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
    setColorAdjust(next) {
      if (next.brightness !== undefined) uBrightness.value = next.brightness;
      if (next.contrast !== undefined) uContrast.value = next.contrast;
      if (next.saturation !== undefined) uSaturation.value = next.saturation;
      if (next.warmth !== undefined) uWarmth.value = next.warmth;
    },
    setNormalColor(on) { uNormalColor.value = on ? 1 : 0; },
    setFade(fadeValue, fadeIn, dither) {
      uFade.value = fadeValue;
      uFadeIn.value = fadeIn ? 1 : 0;
      uDither.value = dither ? 1 : 0;
    },
    setTier(tier) { uTier.value = tier; },
  };
}

export { createBakedMacroTintTexture };
