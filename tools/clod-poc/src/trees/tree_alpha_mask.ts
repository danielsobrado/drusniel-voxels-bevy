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

interface Leaflet {
  cx: number;
  cy: number;
  cos: number;
  sin: number;
  length: number;
  width: number;
  hue: number;
  value: number;
}

/**
 * Each atlas cell is a CLUSTER of small leaflets rather than one solid blob, so a
 * leaf card reads as dappled foliage (gaps between leaves, internal veins, per-leaf
 * value/edge shading) instead of a flat green silhouette. RGB carries a darkening
 * detail modulation (≤1) so the material's per-card vertex colour still drives hue;
 * alpha is the union silhouette of the leaflets.
 */
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
  const leaflets = buildLeaflets(species, settings, seed, cell);
  const roundness = settings.cutoutRoundness;
  for (let py = 0; py < cellSize; py++) {
    for (let px = 0; px < cellSize; px++) {
      const x = (px + 0.5) / cellSize * 2 - 1;
      const y = (py + 0.5) / cellSize * 2 - 1;
      let alpha = 0;
      let shade = 0.5;
      let hue = 0;
      for (const leaf of leaflets) {
        const sample = evalLeaflet(leaf, x, y, roundness);
        if (sample.alpha > alpha) {
          alpha = sample.alpha;
          shade = sample.shade;
          hue = sample.hue;
        }
      }
      const index = ((cellY * cellSize + py) * textureWidth + cellX * cellSize + px) * 4;
      data[index] = Math.round(255 * shade * (1 - Math.max(0, -hue) * 0.12));
      data[index + 1] = Math.round(255 * shade);
      data[index + 2] = Math.round(255 * shade * (1 - Math.max(0, hue) * 0.12));
      data[index + 3] = Math.round(clamp01(alpha) * 255);
    }
  }
}

function buildLeaflets(
  species: Exclude<TreeSpeciesId, "dead">,
  settings: TreeSpeciesFoliageSettings,
  seed: number,
  cell: number,
): Leaflet[] {
  const isPine = species === "pine";
  const count = isPine
    ? Math.max(8, Math.min(20, Math.round(settings.lobeCount * 1.8 + 8)))
    : Math.max(7, Math.min(16, Math.round(settings.lobeCount + 6)));
  const leaflets: Leaflet[] = [];
  for (let k = 0; k < count; k++) {
    const h0 = hash3(cell, k, 1, seed + 24001);
    const h1 = hash3(cell, k, 2, seed + 24011);
    const h2 = hash3(cell, k, 3, seed + 24021);
    const h3 = hash3(cell, k, 4, seed + 24031);
    const h4 = hash3(cell, k, 5, seed + 24041);
    if (isPine) {
      // needles fanning up from a base spread near the bottom of the card
      const angle = Math.PI * 0.5 + (h2 - 0.5) * (1.1 + settings.edgeNoise);
      leaflets.push({
        cx: (h0 - 0.5) * 0.9,
        cy: -0.92 + h1 * 0.55,
        cos: Math.cos(angle),
        sin: Math.sin(angle),
        length: 0.95 + h3 * 0.6,
        width: 0.035 + h4 * 0.03,
        hue: (h2 - 0.5) * 2,
        value: 0.66 + h4 * 0.34,
      });
    } else {
      // broadleaf leaflets radiating outward in a rosette disk
      const r = Math.sqrt(h0) * 0.62;
      const a = h1 * Math.PI * 2;
      const angle = a + (h2 - 0.5) * 1.5;
      leaflets.push({
        cx: Math.cos(a) * r,
        cy: Math.sin(a) * r,
        cos: Math.cos(angle),
        sin: Math.sin(angle),
        length: 0.42 + h3 * 0.3,
        width: 0.17 + h4 * 0.12,
        hue: (h2 - 0.5) * 2,
        value: 0.64 + h4 * 0.36,
      });
    }
  }
  return leaflets;
}

interface LeafletSample {
  alpha: number;
  shade: number;
  hue: number;
}

const EMPTY_LEAFLET: LeafletSample = { alpha: 0, shade: 0.5, hue: 0 };

function evalLeaflet(leaf: Leaflet, x: number, y: number, roundness: number): LeafletSample {
  const dx = x - leaf.cx;
  const dy = y - leaf.cy;
  const along = dx * leaf.cos + dy * leaf.sin; // 0 at base → length at tip
  const across = -dx * leaf.sin + dy * leaf.cos;
  const s = along / leaf.length;
  if (s < 0 || s > 1) return EMPTY_LEAFLET;
  const half = leaf.width * leafProfile(s, roundness);
  if (half <= 0) return EMPTY_LEAFLET;
  const a = Math.abs(across);
  const edge = (half - a) / Math.max(half * 0.5, 0.01); // 1 at midrib, 0 at edge
  if (edge <= 0) return EMPTY_LEAFLET;
  const alpha = clamp01(edge * 4);
  const midrib = Math.exp(-((a / (half * 0.18 + 0.004)) ** 2)); // bright spine
  const valueGrad = 0.62 + 0.38 * s; // dark base → light tip
  const edgeAO = 0.7 + 0.3 * clamp01(edge);
  const vein = 0.88 + 0.12 * midrib;
  const shade = clamp01(valueGrad * edgeAO * vein * leaf.value);
  return { alpha, shade: Math.max(0.4, shade), hue: leaf.hue };
}

function leafProfile(s: number, roundness: number): number {
  const base = smoothstep(0, 0.14, s); // rounded base
  const tip = Math.pow(1 - s, 0.55 + roundness * 0.6); // pointed tip
  return base * tip;
}
