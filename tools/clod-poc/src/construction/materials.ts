import * as THREE from "three";
import type { ConstructionMaterial } from "./types.js";

const WOOD_TEXTURE_SIZE_PX = 256;
const WOOD_GRAIN_ROWS = 32;
const WOOD_GRAIN_SCALE = 0.12;
const WOOD_GRAIN_RING_SCALE = 0.035;
const WOOD_BASE_RGB = [139, 88, 42] as const;
const WOOD_DARK_RGB = [82, 45, 24] as const;
const WOOD_LIGHT_RGB = [186, 126, 63] as const;
const DEFAULT_MATERIAL_COLORS: Record<ConstructionMaterial, number> = {
  wood: 0x9a673a,
  stone: 0x7f858c,
  metal: 0x777f8a,
  thatch: 0xb59b52,
};

let cachedWoodTexture: THREE.CanvasTexture | null = null;

function mixChannel(a: number, b: number, t: number): number {
  return Math.round(a * (1 - t) + b * t);
}

function drawWoodGrain(ctx: CanvasRenderingContext2D): void {
  const width = WOOD_TEXTURE_SIZE_PX;
  const height = WOOD_TEXTURE_SIZE_PX;
  const image = ctx.createImageData(width, height);
  const data = image.data;

  for (let y = 0; y < height; y += 1) {
    const rowWave = Math.sin(y * WOOD_GRAIN_RING_SCALE) * 0.5 + Math.sin(y * WOOD_GRAIN_SCALE) * 0.28;
    for (let x = 0; x < width; x += 1) {
      const grain = Math.sin((x * 0.075) + rowWave * 5.5) * 0.5 + 0.5;
      const knot = Math.sin(Math.hypot(x - 176, y - 118) * 0.13) * Math.max(0, 1 - Math.hypot(x - 176, y - 118) / 84);
      const streak = ((x + Math.floor(rowWave * 18)) % WOOD_GRAIN_ROWS) / WOOD_GRAIN_ROWS;
      const lightMix = Math.max(0, grain * 0.38 + streak * 0.22 + knot * 0.18);
      const darkMix = Math.max(0, (1 - grain) * 0.24 - knot * 0.12);
      const index = (y * width + x) * 4;
      const baseR = mixChannel(WOOD_BASE_RGB[0], WOOD_LIGHT_RGB[0], lightMix);
      const baseG = mixChannel(WOOD_BASE_RGB[1], WOOD_LIGHT_RGB[1], lightMix);
      const baseB = mixChannel(WOOD_BASE_RGB[2], WOOD_LIGHT_RGB[2], lightMix);
      data[index] = mixChannel(baseR, WOOD_DARK_RGB[0], darkMix);
      data[index + 1] = mixChannel(baseG, WOOD_DARK_RGB[1], darkMix);
      data[index + 2] = mixChannel(baseB, WOOD_DARK_RGB[2], darkMix);
      data[index + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
}

function createWoodTexture(): THREE.CanvasTexture | null {
  if (cachedWoodTexture) return cachedWoodTexture;
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = WOOD_TEXTURE_SIZE_PX;
  canvas.height = WOOD_TEXTURE_SIZE_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  drawWoodGrain(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = "construction-procedural-wood";
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.5, 1.0);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  cachedWoodTexture = texture;
  return texture;
}

export function createConstructionMaterial(material: ConstructionMaterial): THREE.MeshStandardMaterial {
  if (material !== "wood") {
    return new THREE.MeshStandardMaterial({
      color: DEFAULT_MATERIAL_COLORS[material],
      roughness: material === "metal" ? 0.46 : 0.78,
      metalness: material === "metal" ? 0.62 : 0.0,
    });
  }

  const woodTexture = createWoodTexture();
  // TODO: Replace this temporary procedural wood with the final construction material asset pipeline.
  return new THREE.MeshStandardMaterial({
    color: woodTexture ? 0xffffff : DEFAULT_MATERIAL_COLORS.wood,
    map: woodTexture ?? undefined,
    roughness: 0.86,
    metalness: 0.0,
  });
}
