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
const DILATION_DISTANCE_PX = 8;
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
      dilateClusterCellRgb(data, width, cellSize, speciesIndex, variant, DILATION_DISTANCE_PX);
    }
  }

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
  const cellOriginX = variant * cellSize;
  const cellOriginY = speciesIndex * cellSize;

  for (const leaf of leaflets) {
    const endX = leaf.cx + leaf.cos * leaf.length;
    const endY = leaf.cy + leaf.sin * leaf.length;
    const padding = leaf.width * 1.25;
    const minPx = normalizedToPixel(Math.min(leaf.cx, endX) - padding, cellSize, false);
    const maxPx = normalizedToPixel(Math.max(leaf.cx, endX) + padding, cellSize, true);
    const minPy = normalizedToPixel(Math.min(leaf.cy, endY) - padding, cellSize, false);
    const maxPy = normalizedToPixel(Math.max(leaf.cy, endY) + padding, cellSize, true);

    for (let py = minPy; py <= maxPy; py++) {
      const y = (py + 0.5) / cellSize * 2 - 1;
      for (let px = minPx; px <= maxPx; px++) {
        const x = (px + 0.5) / cellSize * 2 - 1;
        const sample = evalLeaflet(leaf, x, y, species);
        if (sample.alpha <= 0) continue;
        const offset = ((cellOriginY + py) * textureWidth + cellOriginX + px) * 4;
        if (sample.alpha <= (data[offset + 3] as number) / 255) continue;
        const cool = Math.max(0, -sample.coolWarm);
        const warm = Math.max(0, sample.coolWarm);
        data[offset] = Math.round(255 * clamp01(sample.shade * (1 + warm * 0.1 - cool * 0.08)));
        data[offset + 1] = Math.round(255 * clamp01(sample.shade));
        data[offset + 2] = Math.round(255 * clamp01(sample.shade * (1 + cool * 0.1 - warm * 0.1)));
        data[offset + 3] = Math.round(255 * clamp01(sample.alpha));
      }
    }
  }
}

function normalizedToPixel(value: number, cellSize: number, upper: boolean): number {
  const pixel = (clamp01(value * 0.5 + 0.5) * cellSize) - (upper ? 0 : 1);
  return Math.max(0, Math.min(cellSize - 1, upper ? Math.ceil(pixel) : Math.floor(pixel)));
}

function dilateClusterCellRgb(
  data: Uint8Array,
  textureWidth: number,
  cellSize: number,
  speciesIndex: number,
  variant: number,
  maxDistance: number,
): void {
  const cellPixels = cellSize * cellSize;
  const distance = new Int16Array(cellPixels);
  distance.fill(-1);
  const queue = new Int32Array(cellPixels);
  let head = 0;
  let tail = 0;
  const originX = variant * cellSize;
  const originY = speciesIndex * cellSize;

  for (let y = 0; y < cellSize; y++) {
    for (let x = 0; x < cellSize; x++) {
      const local = y * cellSize + x;
      const offset = ((originY + y) * textureWidth + originX + x) * 4;
      if ((data[offset + 3] as number) === 0) continue;
      distance[local] = 0;
      queue[tail++] = local;
    }
  }

  while (head < tail) {
    const local = queue[head++] as number;
    const currentDistance = distance[local] as number;
    if (currentDistance >= maxDistance) continue;
    const x = local % cellSize;
    const y = Math.floor(local / cellSize);
    const sourceOffset = ((originY + y) * textureWidth + originX + x) * 4;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextY < 0 || nextX >= cellSize || nextY >= cellSize) continue;
        const nextLocal = nextY * cellSize + nextX;
        if ((distance[nextLocal] as number) >= 0) continue;
        const nextOffset = ((originY + nextY) * textureWidth + originX + nextX) * 4;
        data[nextOffset] = data[sourceOffset] as number;
        data[nextOffset + 1] = data[sourceOffset + 1] as number;
        data[nextOffset + 2] = data[sourceOffset + 2] as number;
        distance[nextLocal] = currentDistance + 1;
        queue[tail++] = nextLocal;
      }
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
