import * as THREE from "three";
import { bakeNoiseTextures, sampleNoiseChannel, type NoiseBakeResult } from "./noiseBake.js";
import { bakeTerrainClassificationTexture, type TerrainClassificationBakeResult } from "./terrainClassificationBake.js";
import {
  type ProceduralMaterialId,
  type ProceduralMaterialRecipe,
  type ProceduralTextureConfig,
} from "./materialRecipes.js";
import {
  createProceduralTextureManifest,
  type ProceduralTextureManifest,
} from "./textureManifest.js";

export interface ProceduralTerrainSlot {
  texture: THREE.Texture | null;
  normalTexture: THREE.Texture | null;
  scale: number;
  heightMin: number;
  heightMax: number;
  name: string;
  previewUrl: string | null;
  selectedId: string;
}

export interface ProceduralTerrainTextures {
  noise: NoiseBakeResult;
  classification: TerrainClassificationBakeResult;
  albedoArray: THREE.DataArrayTexture;
  normalArray: THREE.DataArrayTexture;
  slots: ProceduralTerrainSlot[];
  normalMapMask: Float32Array;
  roughnessByLayer: Float32Array;
  manifest: ProceduralTextureManifest;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function colorByte(value: number): number {
  return Math.round(clamp01(value) * 255);
}

function layerRanges(id: ProceduralMaterialId, fallbackIndex: number): { heightMin: number; heightMax: number; scale: number } {
  switch (id) {
    case "sand": return { heightMin: 0, heightMax: 18, scale: 0.055 };
    case "grass": return { heightMin: 12, heightMax: 46, scale: 0.06 };
    case "dirt": return { heightMin: 16, heightMax: 58, scale: 0.045 };
    case "rock": return { heightMin: 38, heightMax: 88, scale: 0.04 };
    case "snow": return { heightMin: 62, heightMax: 128, scale: 0.035 };
    case "moss": return { heightMin: 18, heightMax: 72, scale: 0.07 };
    case "gravel": return { heightMin: 10, heightMax: 54, scale: 0.065 };
    case "wet_soil": return { heightMin: 0, heightMax: 22, scale: 0.05 };
    default: return { heightMin: fallbackIndex * 8, heightMax: fallbackIndex * 8 + 24, scale: 0.05 };
  }
}

function base64EncodeAscii(value: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < value.length; i += 3) {
    const a = value.charCodeAt(i);
    const b = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
    const c = i + 2 < value.length ? value.charCodeAt(i + 2) : 0;
    const n = (a << 16) | (b << 8) | c;
    out += alphabet[(n >> 18) & 63];
    out += alphabet[(n >> 12) & 63];
    out += i + 1 < value.length ? alphabet[(n >> 6) & 63] : "=";
    out += i + 2 < value.length ? alphabet[n & 63] : "=";
  }
  return out;
}

function previewDataUrl(recipe: ProceduralMaterialRecipe): string {
  const [r, g, b] = recipe.base_color.map(colorByte);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="rgb(${r},${g},${b})"/></svg>`;
  return `data:image/svg+xml;base64,${base64EncodeAscii(svg)}`;
}

function materialAlbedo(id: ProceduralMaterialId, recipe: ProceduralMaterialRecipe, macro: number, meso: number, micro: number, worley: number, y01: number): [number, number, number] {
  let [r, g, b] = recipe.base_color;
  const macroShift = (macro - 0.5) * recipe.macro_strength;
  const mesoShift = (meso - 0.5) * 0.22;
  r *= 1 + macroShift + mesoShift;
  g *= 1 + macroShift + mesoShift;
  b *= 1 + macroShift + mesoShift;

  if (id === "rock") {
    const strata = 0.5 + 0.5 * Math.sin(y01 * Math.PI * 22 + macro * 4);
    const rust = (recipe.strata_strength ?? 0) * Math.max(0, strata - 0.55);
    r = r * (1 + rust * 0.55);
    g = g * (1 - rust * 0.18);
    b = b * (1 - rust * 0.32);
  } else if (id === "grass") {
    const dry = clamp01((worley - 0.44) * 2.2);
    r = r * (1 + dry * 0.9);
    g = g * (1 - dry * 0.18);
    b = b * (1 - dry * 0.55);
  } else if (id === "snow") {
    const sparkle = (recipe.sparkle_strength ?? 0) * Math.max(0, micro - 0.85);
    r += sparkle;
    g += sparkle;
    b += sparkle;
  } else if (id === "wet_soil") {
    r *= 0.72;
    g *= 0.76;
    b *= 0.82;
  } else if (id === "gravel") {
    const pebble = clamp01(1 - worley);
    r *= 0.82 + pebble * 0.34;
    g *= 0.82 + pebble * 0.34;
    b *= 0.82 + pebble * 0.34;
  }

  return [clamp01(r), clamp01(g), clamp01(b)];
}

function makeArrayTexture(data: Uint8Array, size: number, layers: number, colorSpace: THREE.ColorSpace): THREE.DataArrayTexture {
  const texture = new THREE.DataArrayTexture(data as Uint8Array<ArrayBuffer>, size, size, layers);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = colorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createProceduralTerrainTextures(config: ProceduralTextureConfig): ProceduralTerrainTextures {
  const noise = bakeNoiseTextures({
    seed: config.seed,
    resolution: config.noise.resolution,
    periods: config.noise.periods,
  });
  const classification = bakeTerrainClassificationTexture({ config, noise });
  const layerSize = Math.max(2, Math.floor(config.terrain.layer_resolution));
  const order = config.terrain.material_order;
  const layers = order.length;
  const stride = layerSize * layerSize * 4;
  const albedo = new Uint8Array(stride * layers);
  const normal = new Uint8Array(stride * layers);
  const roughnessByLayer = new Float32Array(layers);
  const normalMapMask = new Float32Array(layers);

  for (let layer = 0; layer < layers; layer++) {
    const id = order[layer];
    const recipe = config.terrain.materials[id];
    roughnessByLayer[layer] = recipe.roughness;
    normalMapMask[layer] = recipe.normal_strength > 0 ? 1 : 0;
    for (let y = 0; y < layerSize; y++) {
      for (let x = 0; x < layerSize; x++) {
        const u = (x + 0.5) / layerSize;
        const v = (y + 0.5) / layerSize;
        const macro = sampleNoiseChannel(noise.dataA, noise.resolution, u * 0.25 + layer * 0.113, v * 0.25, 0);
        const meso = sampleNoiseChannel(noise.dataA, noise.resolution, u * 4 + layer * 0.071, v * 4, 1);
        const gradX = sampleNoiseChannel(noise.dataA, noise.resolution, u * 8, v * 8, 2) * 2 - 1;
        const gradY = sampleNoiseChannel(noise.dataA, noise.resolution, u * 8, v * 8, 3) * 2 - 1;
        const ridged = sampleNoiseChannel(noise.dataB, noise.resolution, u * 2 + layer * 0.17, v * 2, 2);
        const worley = sampleNoiseChannel(noise.dataB, noise.resolution, u * 3, v * 3 + layer * 0.19, 3);
        const micro = sampleNoiseChannel(noise.dataA, noise.resolution, u * 15 + 0.37, v * 15 + 0.61, 0);
        const [r, g, b] = materialAlbedo(id, recipe, macro, meso, micro, worley, v);
        const i = layer * stride + (y * layerSize + x) * 4;
        albedo[i] = colorByte(r);
        albedo[i + 1] = colorByte(g);
        albedo[i + 2] = colorByte(b);
        albedo[i + 3] = 255;

        const strength = recipe.normal_strength * config.terrain.micro_normal.max_strength * (0.6 + ridged * 0.7);
        const nx = clamp01(0.5 - gradX * strength);
        const ny = clamp01(0.5 - gradY * strength);
        normal[i] = colorByte(nx);
        normal[i + 1] = colorByte(ny);
        normal[i + 2] = colorByte(1);
        normal[i + 3] = colorByte(recipe.roughness);
      }
    }
  }

  const albedoArray = makeArrayTexture(albedo, layerSize, layers, THREE.SRGBColorSpace);
  const normalArray = makeArrayTexture(normal, layerSize, layers, THREE.NoColorSpace);
  const slots = order.map((id, index) => ({
    texture: null,
    normalTexture: null,
    name: id.replace("_", " "),
    selectedId: `generated:${id}`,
    previewUrl: previewDataUrl(config.terrain.materials[id]),
    ...layerRanges(id, index),
  }));
  const manifest = createProceduralTextureManifest({
    seed: config.seed,
    config,
    noiseResolution: noise.resolution,
    layerResolution: layerSize,
    materialOrder: order,
  });

  return { noise, classification, albedoArray, normalArray, slots, normalMapMask, roughnessByLayer, manifest };
}
