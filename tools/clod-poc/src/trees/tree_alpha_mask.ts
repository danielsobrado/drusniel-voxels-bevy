import * as THREE from "three";
import { TREE_SPECIES, type TreeSettings, type TreeSpeciesId } from "./tree_config.js";
import { VEG_TREE_SPECIES } from "../veg/veg_species.js";
import { clamp01, hash3, smoothstep } from "./tree_noise.js";

export const TREE_FOLIAGE_ATLAS_VARIANTS = 4;
export const TREE_FOLIAGE_ATLAS_COLUMNS = TREE_FOLIAGE_ATLAS_VARIANTS;
export const TREE_FOLIAGE_ATLAS_ROWS = TREE_SPECIES.length;

export interface TreeFoliageAtlas {
  texture: THREE.DataTexture;
  columns: number;
  rows: number;
  cellSize: number;
  dispose(): void;
}

interface Leaflet {
  cx: number;
  cy: number;
  cos: number;
  sin: number;
  length: number;
  width: number;
  value: number;
  coolWarm: number;
}

interface LeafletSample {
  alpha: number;
  shade: number;
  coolWarm: number;
}

const EMPTY_LEAFLET: LeafletSample = { alpha: 0, shade: 0.5, coolWarm: 0 };
const DILATION_PASSES = 8;
const FOLIAGE_ATLAS_ANISOTROPY = 8;

export function createTreeFoliageAtlas(settings: TreeSettings): TreeFoliageAtlas {
  const cellSize = Math.max(32, Math.floor(settings.foliage.maskResolutionPx));
  const width = TREE_FOLIAGE_ATLAS_COLUMNS * cellSize;
  const height = TREE_FOLIAGE_ATLAS_ROWS * cellSize;
  const data = new Uint8Array(width * height * 4);

  for (let speciesIndex = 0; speciesIndex < TREE_SPECIES.length; speciesIndex++) {
    const species = TREE_SPECIES[speciesIndex] as TreeSpeciesId;
    if (!VEG_TREE_SPECIES[species].foliage) continue;
    for (let variant = 0; variant < TREE_FOLIAGE_ATLAS_VARIANTS; variant++) {
      writeClusterCell(data, width, cellSize, speciesIndex, variant, species, settings.seed);
    }
  }
  dilateTransparentRgb(data, width, height, DILATION_PASSES);

  const texture = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = "tree-foliage-cluster-atlas";
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = FOLIAGE_ATLAS_ANISOTROPY;
  texture.needsUpdate = true;

  return {
    texture,
    columns: TREE_FOLIAGE_ATLAS_COLUMNS,
    rows: TREE_FOLIAGE_ATLAS_ROWS,
    cellSize,
    dispose() {
      texture.dispose();
    },
  };
}

export function treeSpeciesAtlasIndex(species: TreeSpeciesId): number {
  return Math.max(0, TREE_SPECIES.indexOf(species));
}

export function foliageAtlasCell(
  species: Exclude<TreeSpeciesId, "dead">,
  variant: number,
  _settings?: TreeSettings,
): number {
  return treeSpeciesAtlasIndex(species) * TREE_FOLIAGE_ATLAS_COLUMNS
    + Math.abs(Math.floor(variant)) % TREE_FOLIAGE_ATLAS_VARIANTS;
}

export function foliageAtlasUvAt(
  localU: number,
  localV: number,
  speciesIndex: number,
): readonly [number, number] {
  const u = clamp01(localU);
  const v = clamp01(localV);
  const tileX = Math.min(1, Math.floor(u * 2));
  const tileY = Math.min(1, Math.floor(v * 2));
  const tile = tileX + tileY * 2;
  const withinU = u * 2 - tileX;
  const withinV = v * 2 - tileY;
  const row = Math.max(0, Math.min(TREE_FOLIAGE_ATLAS_ROWS - 1, Math.floor(speciesIndex)));
  return [
    (tile + withinU) / TREE_FOLIAGE_ATLAS_COLUMNS,
    (row + withinV) / TREE_FOLIAGE_ATLAS_ROWS,
  ];
}

function writeClusterCell(
  data: Uint8Array,
  textureWidth: number,
  cellSize: number,
  speciesIndex: number,
  variant: number,
  species: TreeSpeciesId,
  seed: number,
): void {
  const leaflets = buildLeaflets(species, seed, variant);
  const cellX = variant;
  const cellY = speciesIndex;

  for (let py = 0; py < cellSize; py++) {
    for (let px = 0; px < cellSize; px++) {
      const x = (px + 0.5) / cellSize * 2 - 1;
      const y = (py + 0.5) / cellSize * 2 - 1;
      let best = EMPTY_LEAFLET;
      for (const leaf of leaflets) {
        const sample = evalLeaflet(leaf, x, y, species);
        if (sample.alpha > best.alpha) best = sample;
      }

      const offset = ((cellY * cellSize + py) * textureWidth + cellX * cellSize + px) * 4;
      const cool = Math.max(0, -best.coolWarm);
      const warm = Math.max(0, best.coolWarm);
      data[offset] = Math.round(255 * clamp01(best.shade * (1 + warm * 0.1 - cool * 0.08)));
      data[offset + 1] = Math.round(255 * clamp01(best.shade));
      data[offset + 2] = Math.round(255 * clamp01(best.shade * (1 + cool * 0.1 - warm * 0.1)));
      data[offset + 3] = Math.round(255 * clamp01(best.alpha));
    }
  }
}

function buildLeaflets(species: TreeSpeciesId, seed: number, variant: number): Leaflet[] {
  const params = VEG_TREE_SPECIES[species];
  const conifer = params.kind === "conifer";
  const sourceNeedleCount = params.foliage?.leaf.needleCount ?? 24;
  const baseCount = conifer
    ? Math.max(32, Math.round(sourceNeedleCount * 0.9))
    : 24;
  const count = Math.min(conifer ? 64 : 34, baseCount + variant * (conifer ? 4 : 2));
  const leaflets: Leaflet[] = [];

  for (let index = 0; index < count; index++) {
    const h0 = hash3(variant, index, 1, seed + treeSpeciesAtlasIndex(species) * 17011);
    const h1 = hash3(variant, index, 2, seed + treeSpeciesAtlasIndex(species) * 17021);
    const h2 = hash3(variant, index, 3, seed + treeSpeciesAtlasIndex(species) * 17031);
    const h3 = hash3(variant, index, 4, seed + treeSpeciesAtlasIndex(species) * 17041);
    const h4 = hash3(variant, index, 5, seed + treeSpeciesAtlasIndex(species) * 17051);

    if (conifer) {
      const t = count <= 1 ? 0 : index / (count - 1);
      const side = index % 2 === 0 ? 1 : -1;
      const angle = Math.PI * 0.5 + side * (0.42 + h2 * 0.85);
      leaflets.push({
        cx: side * (0.05 + h0 * 0.34) * (0.45 + t),
        cy: -0.86 + t * 1.5 + (h1 - 0.5) * 0.16,
        cos: Math.cos(angle),
        sin: Math.sin(angle),
        length: 0.48 + h3 * 0.42,
        width: 0.018 + h4 * 0.03,
        value: 0.68 + h4 * 0.32,
        coolWarm: (h2 - 0.5) * 2,
      });
    } else {
      const radial = Math.sqrt(h0) * 0.68;
      const around = h1 * Math.PI * 2;
      const direction = around + (h2 - 0.5) * 1.35;
      leaflets.push({
        cx: Math.cos(around) * radial,
        cy: Math.sin(around) * radial * 0.78,
        cos: Math.cos(direction),
        sin: Math.sin(direction),
        length: 0.34 + h3 * 0.3,
        width: 0.11 + h4 * 0.11,
        value: 0.64 + h4 * 0.36,
        coolWarm: (h2 - 0.5) * 2,
      });
    }
  }
  return leaflets;
}

function evalLeaflet(
  leaf: Leaflet,
  x: number,
  y: number,
  species: TreeSpeciesId,
): LeafletSample {
  const dx = x - leaf.cx;
  const dy = y - leaf.cy;
  const along = dx * leaf.cos + dy * leaf.sin;
  const across = -dx * leaf.sin + dy * leaf.cos;
  const s = along / leaf.length;
  if (s < 0 || s > 1) return EMPTY_LEAFLET;

  const profile = VEG_TREE_SPECIES[species].kind === "conifer"
    ? Math.sin(Math.PI * clamp01(s)) ** 0.35
    : leafProfile(s, VEG_TREE_SPECIES[species].foliage?.leaf.shapePow ?? 1.2);
  const halfWidth = leaf.width * profile;
  if (halfWidth <= 0) return EMPTY_LEAFLET;
  const edge = (halfWidth - Math.abs(across)) / Math.max(halfWidth * 0.45, 0.006);
  if (edge <= 0) return EMPTY_LEAFLET;

  const alpha = clamp01(edge * 4);
  const midrib = Math.exp(-((Math.abs(across) / (halfWidth * 0.2 + 0.003)) ** 2));
  const valueGradient = 0.68 + 0.32 * s;
  const edgeAo = 0.72 + 0.28 * clamp01(edge);
  const shade = clamp01(valueGradient * edgeAo * (0.9 + 0.1 * midrib) * leaf.value);
  return { alpha, shade: Math.max(0.38, shade), coolWarm: leaf.coolWarm };
}

function leafProfile(s: number, shapePower: number): number {
  const base = smoothstep(0, 0.13, s);
  const body = Math.pow(Math.sin(Math.PI * Math.min(1, s * 0.91 + 0.045)), Math.max(0.5, shapePower));
  const tip = Math.pow(1 - s, 0.28);
  return base * body * tip;
}

function dilateTransparentRgb(data: Uint8Array, width: number, height: number, passes: number): void {
  const originalAlpha = new Uint8Array(width * height);
  for (let pixel = 0; pixel < width * height; pixel++) originalAlpha[pixel] = data[pixel * 4 + 3] as number;

  for (let pass = 0; pass < passes; pass++) {
    const source = data.slice();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixel = y * width + x;
        const offset = pixel * 4;
        if ((originalAlpha[pixel] as number) > 0) continue;
        let red = 0;
        let green = 0;
        let blue = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const sampleX = x + dx;
            const sampleY = y + dy;
            if (sampleX < 0 || sampleY < 0 || sampleX >= width || sampleY >= height) continue;
            const sampleOffset = (sampleY * width + sampleX) * 4;
            if ((source[sampleOffset] as number) === 0
              && (source[sampleOffset + 1] as number) === 0
              && (source[sampleOffset + 2] as number) === 0) continue;
            red += source[sampleOffset] as number;
            green += source[sampleOffset + 1] as number;
            blue += source[sampleOffset + 2] as number;
            count++;
          }
        }
        if (count > 0) {
          data[offset] = Math.round(red / count);
          data[offset + 1] = Math.round(green / count);
          data[offset + 2] = Math.round(blue / count);
          data[offset + 3] = 0;
        }
      }
    }
  }
}
