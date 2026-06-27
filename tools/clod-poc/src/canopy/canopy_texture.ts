import * as THREE from "three";
import type { TerrainSummaryField } from "../clod/terrain_summary.js";
import { createExtendedCanopyTexture, createExtendedHeightTexture } from "../clod/terrain_summary.js";
import type { CanopyShellConfig } from "./canopy_types_internal.js";
import type { CanopySummaryTile, CanopyTextureSet } from "./canopy_types.js";
import { stableTileKey } from "./canopy_types.js";
import { clamp01 } from "./canopy_hash.js";

function makeDataTexture(data: Float32Array, res: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, res, res, THREE.RedFormat, THREE.FloatType);
  tex.needsUpdate = true;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function makeRgbTexture(data: Float32Array, res: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, res, res, THREE.RGBFormat, THREE.FloatType);
  tex.needsUpdate = true;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function textureResolutionForConfig(config: CanopyShellConfig): number {
  const shellEndM = finiteOr(config.distances.shellEndM, 1024);
  const extentM = Math.max(1, shellEndM * 2);
  const cellSizeM = Math.max(
    1,
    finiteOr(config.clipmap.rings[0]?.cellSizeM ?? config.clipmap.cellSizeM, 8),
  );
  return Math.min(512, Math.max(64, Math.ceil(extentM / cellSizeM)));
}

function safeCoverage(coverage: number, coverageAlphaPower: number): number {
  const base = clamp01(finiteOr(coverage, 0));
  const power = Number.isFinite(coverageAlphaPower) && coverageAlphaPower > 0
    ? coverageAlphaPower
    : 1;
  return clamp01(Math.pow(base, power));
}

function safeSpeciesTint(
  pine: number,
  broadleaf: number,
  deadwood: number,
  config: CanopyShellConfig,
): [number, number, number] {
  const p = clamp01(finiteOr(pine, 0));
  const b = clamp01(finiteOr(broadleaf, 0));
  const d = clamp01(finiteOr(deadwood, 0));
  const sum = p + b + d;
  if (sum <= 0) return [...config.material.baseTint];
  const pn = p / sum;
  const bn = b / sum;
  const dn = d / sum;
  return [
    clamp01(pn * config.material.pineTint[0] + bn * config.material.broadleafTint[0] + dn * config.material.deadwoodTint[0]),
    clamp01(pn * config.material.pineTint[1] + bn * config.material.broadleafTint[1] + dn * config.material.deadwoodTint[1]),
    clamp01(pn * config.material.pineTint[2] + bn * config.material.broadleafTint[2] + dn * config.material.deadwoodTint[2]),
  ];
}

function buildTileMap(visibleTiles: CanopySummaryTile[]): Map<string, CanopySummaryTile> {
  const tileMap = new Map<string, CanopySummaryTile>();
  for (const tile of visibleTiles) {
    tileMap.set(stableTileKey(tile.key.tileX, tile.key.tileZ), tile);
  }
  return tileMap;
}

function findCellAtWorldFast(
  tileMap: Map<string, CanopySummaryTile>,
  worldX: number,
  worldZ: number,
  tileSizeM: number,
) {
  const tileX = Math.floor(worldX / tileSizeM);
  const tileZ = Math.floor(worldZ / tileSizeM);
  const tile = tileMap.get(stableTileKey(tileX, tileZ));
  if (!tile) return null;

  const gx = Math.min(tile.resolution - 1, Math.floor((worldX - tile.originX) / tile.cellSizeM));
  const gz = Math.min(tile.resolution - 1, Math.floor((worldZ - tile.originZ) / tile.cellSizeM));
  if (gx < 0 || gz < 0 || gx >= tile.resolution || gz >= tile.resolution) return null;

  return tile.cells[gz * tile.resolution + gx];
}

export interface BuildCanopyTextureSetParams {
  visibleTiles: CanopySummaryTile[];
  config: CanopyShellConfig;
  centerX: number;
  centerZ: number;
  syntheticFallback?: boolean;
  terrainSummary?: TerrainSummaryField | null;
  farRadius?: number;
}

let textureRevision = 0;

export function buildCanopyTextureSet(params: BuildCanopyTextureSetParams): CanopyTextureSet {
  const { config, centerX, centerZ, visibleTiles, syntheticFallback } = params;
  const shellEndM = Math.max(1, finiteOr(config.distances.shellEndM, 1024));
  const extentM = shellEndM * 2;
  const originX = centerX - shellEndM;
  const originZ = centerZ - shellEndM;
  const resolution = textureResolutionForConfig(config);

  if (syntheticFallback && params.terrainSummary) {
    const farRadius = Math.max(1, finiteOr(params.farRadius ?? config.distances.shellEndM, shellEndM));
    const heightTexture = createExtendedHeightTexture(params.terrainSummary, farRadius);
    const coverageTexture = createExtendedCanopyTexture(params.terrainSummary, farRadius, config.seed);
    const speciesData = new Float32Array(resolution * resolution * 3);
    speciesData.fill(0.2);
    const roughnessData = new Float32Array(resolution * resolution);
    textureRevision++;
    return {
      heightTexture,
      coverageTexture,
      speciesTexture: makeRgbTexture(speciesData, resolution),
      roughnessTexture: makeDataTexture(roughnessData, resolution),
      originX: params.terrainSummary.worldSize / 2 - farRadius,
      originZ: params.terrainSummary.worldSize / 2 - farRadius,
      extentM: farRadius * 2,
      resolution,
      syntheticFallback: true,
      revision: textureRevision,
    };
  }

  const heightData = new Float32Array(resolution * resolution);
  const coverageData = new Float32Array(resolution * resolution);
  const speciesData = new Float32Array(resolution * resolution * 3);
  const roughnessData = new Float32Array(resolution * resolution);
  const tileSizeM = Math.max(1, finiteOr(config.clipmap.tileSizeM, 512));
  const tileMap = buildTileMap(visibleTiles);

  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      const wx = originX + ((i + 0.5) / resolution) * extentM;
      const wz = originZ + ((j + 0.5) / resolution) * extentM;
      const cell = findCellAtWorldFast(tileMap, wx, wz, tileSizeM);
      const idx = j * resolution + i;
      if (!cell) {
        heightData[idx] = 0;
        coverageData[idx] = 0;
        speciesData[idx * 3] = config.material.baseTint[0];
        speciesData[idx * 3 + 1] = config.material.baseTint[1];
        speciesData[idx * 3 + 2] = config.material.baseTint[2];
        roughnessData[idx] = 0;
        continue;
      }
      heightData[idx] = finiteOr(cell.canopyHeight, finiteOr(cell.groundHeight, 0));
      coverageData[idx] = safeCoverage(cell.coverage, config.material.coverageAlphaPower);
      const tint = safeSpeciesTint(cell.speciesPine, cell.speciesBroadleaf, cell.speciesDeadwood, config);
      speciesData[idx * 3] = tint[0];
      speciesData[idx * 3 + 1] = tint[1];
      speciesData[idx * 3 + 2] = tint[2];
      roughnessData[idx] = clamp01(finiteOr(cell.crownRoughness, 0));
    }
  }

  textureRevision++;
  return {
    heightTexture: makeDataTexture(heightData, resolution),
    coverageTexture: makeDataTexture(coverageData, resolution),
    speciesTexture: makeRgbTexture(speciesData, resolution),
    roughnessTexture: makeDataTexture(roughnessData, resolution),
    originX,
    originZ,
    extentM,
    resolution,
    syntheticFallback: false,
    revision: textureRevision,
  };
}

export function disposeCanopyTextureSet(set: CanopyTextureSet | null): void {
  if (!set) return;
  set.heightTexture.dispose();
  set.coverageTexture.dispose();
  set.speciesTexture.dispose();
  set.roughnessTexture.dispose();
}

export function clampTextureValues(set: CanopyTextureSet): boolean {
  const check = (arr: Float32Array) => {
    for (let i = 0; i < arr.length; i++) {
      if (!Number.isFinite(arr[i])) return false;
      arr[i] = clamp01(arr[i]);
    }
    return true;
  };
  const h = set.heightTexture.image.data as Float32Array;
  const c = set.coverageTexture.image.data as Float32Array;
  const r = set.roughnessTexture.image.data as Float32Array;
  return check(c) && check(r) && h.every(Number.isFinite);
}
