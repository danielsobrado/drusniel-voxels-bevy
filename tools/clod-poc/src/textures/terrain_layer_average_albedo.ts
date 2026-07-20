import {
  DEFAULT_PROCEDURAL_MATERIAL_RECIPES,
  type ProceduralMaterialId,
} from "./materialRecipes.js";

export type AverageLinearRgb = [number, number, number];

// Average albedo per terrain texture layer, in linear space. The far clipmap
// derives its land palette from these so the far bands agree with the near
// textured terrain by construction instead of via hand-tuned constants.
// Layers that are not resident in the current bake (inactive biome materials)
// fall back to their recipe base colour decoded from sRGB.
let bakedAverages: Partial<Record<ProceduralMaterialId, AverageLinearRgb>> = {};
let revision = 0;

let srgbToLinearLut: Float32Array | null = null;

function srgbByteToLinear(byte: number): number {
  if (!srgbToLinearLut) {
    srgbToLinearLut = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const c = i / 255;
      srgbToLinearLut[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
  }
  return srgbToLinearLut[byte];
}

const AVERAGE_SAMPLE_STRIDE = 2;

export function recordTerrainLayerAverageAlbedos(
  order: readonly ProceduralMaterialId[],
  albedo: Uint8Array,
  layerSize: number,
): void {
  const stride = layerSize * layerSize * 4;
  const next: Partial<Record<ProceduralMaterialId, AverageLinearRgb>> = {};
  for (let layer = 0; layer < order.length; layer++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (let y = 0; y < layerSize; y += AVERAGE_SAMPLE_STRIDE) {
      for (let x = 0; x < layerSize; x += AVERAGE_SAMPLE_STRIDE) {
        const i = layer * stride + (y * layerSize + x) * 4;
        r += srgbByteToLinear(albedo[i]);
        g += srgbByteToLinear(albedo[i + 1]);
        b += srgbByteToLinear(albedo[i + 2]);
        count++;
      }
    }
    if (count > 0) next[order[layer]] = [r / count, g / count, b / count];
  }
  // Merge, don't replace: a re-bake with a subset of layers (biome material
  // streaming) must not silently reset other layers to recipe fallbacks.
  bakedAverages = { ...bakedAverages, ...next };
  revision++;
}

export function terrainLayerAverageAlbedoRevision(): number {
  return revision;
}

export function getTerrainLayerAverageAlbedo(id: ProceduralMaterialId): AverageLinearRgb {
  const baked = bakedAverages[id];
  if (baked) return baked;
  const base = DEFAULT_PROCEDURAL_MATERIAL_RECIPES[id].base_color;
  return [
    srgbByteToLinear(Math.round(Math.min(1, Math.max(0, base[0])) * 255)),
    srgbByteToLinear(Math.round(Math.min(1, Math.max(0, base[1])) * 255)),
    srgbByteToLinear(Math.round(Math.min(1, Math.max(0, base[2])) * 255)),
  ];
}
