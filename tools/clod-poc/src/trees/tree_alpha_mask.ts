import * as THREE from "three";
import type { TreeSettings, TreeSpeciesFoliageSettings, TreeSpeciesId } from "./tree_config.js";
import { clamp01, hash3, smoothstep } from "./tree_noise.js";

export interface TreeFoliageAtlas {
  texture: THREE.DataTexture;
  columns: number;
  rows: number;
  dispose(): void;
}

export function createTreeFoliageAtlas(settings: TreeSettings): TreeFoliageAtlas {
  const foliage = settings.foliage;
  const cellSize = foliage.maskResolutionPx;
  const columns = foliage.textureAtlasColumns;
  const rows = foliage.textureAtlasRows;
  const width = columns * cellSize;
  const height = rows * cellSize;
  const data = new Uint8Array(width * height * 4);
  for (let cell = 0; cell < columns * rows; cell++) {
    const species: TreeSpeciesId = cell < Math.ceil(columns * rows * 0.5) ? "oak" : "pine";
    const speciesSettings = species === "oak" ? foliage.oak : foliage.pine;
    writeMaskCell(data, width, cellSize, columns, cell, species, speciesSettings, settings.seed);
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.name = "tree-foliage-alpha-atlas";
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return {
    texture,
    columns,
    rows,
    dispose() {
      texture.dispose();
    },
  };
}

export function foliageAtlasCell(species: Exclude<TreeSpeciesId, "dead">, variant: number, settings: TreeSettings): number {
  const cellCount = settings.foliage.textureAtlasColumns * settings.foliage.textureAtlasRows;
  const split = Math.max(1, Math.ceil(cellCount * 0.5));
  if (species === "oak") return Math.abs(Math.floor(variant)) % split;
  return split + (Math.abs(Math.floor(variant)) % Math.max(1, cellCount - split));
}

function writeMaskCell(
  data: Uint8Array,
  textureWidth: number,
  cellSize: number,
  columns: number,
  cell: number,
  species: Exclude<TreeSpeciesId, "dead">,
  settings: TreeSpeciesFoliageSettings,
  seed: number,
): void {
  const cellX = cell % columns;
  const cellY = Math.floor(cell / columns);
  for (let py = 0; py < cellSize; py++) {
    for (let px = 0; px < cellSize; px++) {
      const u = (px + 0.5) / cellSize;
      const v = (py + 0.5) / cellSize;
      const x = u * 2 - 1;
      const y = v * 2 - 1;
      const alpha = species === "oak"
        ? oakAlpha(x, y, settings, seed, cell)
        : pineAlpha(x, y, settings, seed, cell);
      const index = ((cellY * cellSize + py) * textureWidth + cellX * cellSize + px) * 4;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = alpha;
    }
  }
}

function oakAlpha(x: number, y: number, settings: TreeSpeciesFoliageSettings, seed: number, cell: number): number {
  const angle = Math.atan2(y, x);
  const radius = Math.hypot(x, y);
  let edge = 0.78;
  for (let lobe = 0; lobe < settings.lobeCount; lobe++) {
    const phase = hash3(cell, lobe, 1, seed + 17011) * Math.PI * 2;
    edge += Math.cos(angle * (lobe + 2) + phase) * settings.edgeNoise * 0.055;
  }
  edge += (hash3(Math.floor((x + 1) * 8), Math.floor((y + 1) * 8), cell, seed + 17021) - 0.5) * settings.edgeNoise * 0.18;
  const superEllipse = Math.pow(Math.abs(x), 2.4 - settings.cutoutRoundness) + Math.pow(Math.abs(y * 1.08), 2.4 - settings.cutoutRoundness);
  const inside = Math.min(radius / Math.max(0.05, edge), superEllipse);
  return alphaStep(inside);
}

function pineAlpha(x: number, y: number, settings: TreeSpeciesFoliageSettings, seed: number, cell: number): number {
  const taper = 1 - Math.max(0, y) * 0.24;
  const width = (0.46 + (1 - y) * 0.18) * taper;
  const jagged = (hash3(Math.floor((x + 1) * 12), Math.floor((y + 1) * 16), cell, seed + 18011) - 0.5) * settings.edgeNoise * 0.32;
  const needles = Math.sin((x * settings.lobeCount + y * 2.5) * Math.PI) * settings.edgeNoise * 0.08;
  const edgeX = width + jagged + needles;
  const vertical = Math.abs(y) <= 0.94 ? 0 : Math.abs(y) - 0.94;
  const inside = Math.max(Math.abs(x) / Math.max(0.05, edgeX), vertical * 8);
  return alphaStep(inside);
}

function alphaStep(distance: number): number {
  const alpha = 1 - smoothstep(0.92, 1.02, distance);
  return Math.round(clamp01(alpha) * 255);
}
