import * as THREE from "three";
import type { TerrainSummaryField } from "../clod/terrain_summary.js";
import { createExtendedCanopyTexture, createExtendedHeightTexture } from "../clod/terrain_summary.js";
import type { CanopyShellConfig } from "./canopy_types_internal.js";
import type { CanopySummaryTile, CanopyTextureSet } from "./canopy_types.js";
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

function findCellAtWorld(tiles: CanopySummaryTile[], worldX: number, worldZ: number) {
  for (const tile of tiles) {
    const maxX = tile.originX + tile.resolution * tile.cellSizeM;
    const maxZ = tile.originZ + tile.resolution * tile.cellSizeM;
    if (worldX < tile.originX || worldZ < tile.originZ || worldX >= maxX || worldZ >= maxZ) continue;
    const gx = Math.min(tile.resolution - 1, Math.floor((worldX - tile.originX) / tile.cellSizeM));
    const gz = Math.min(tile.resolution - 1, Math.floor((worldZ - tile.originZ) / tile.cellSizeM));
    return tile.cells[gz * tile.resolution + gx];
  }
  return null;
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
  const extentM = config.distances.shellEndM * 2;
  const originX = centerX - config.distances.shellEndM;
  const originZ = centerZ - config.distances.shellEndM;
  const cellSizeM = config.clipmap.rings[0]?.cellSizeM ?? config.clipmap.cellSizeM;
  const resolution = Math.min(512, Math.max(64, Math.ceil(extentM / cellSizeM)));

  if (syntheticFallback && params.terrainSummary) {
    const farRadius = params.farRadius ?? config.distances.shellEndM;
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

  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      const wx = originX + ((i + 0.5) / resolution) * extentM;
      const wz = originZ + ((j + 0.5) / resolution) * extentM;
      const cell = findCellAtWorld(visibleTiles, wx, wz);
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
      heightData[idx] = Number.isFinite(cell.canopyHeight) ? cell.canopyHeight : cell.groundHeight;
      coverageData[idx] = clamp01(Math.pow(cell.coverage, config.material.coverageAlphaPower));
      speciesData[idx * 3] = cell.speciesPine * config.material.pineTint[0]
        + cell.speciesBroadleaf * config.material.broadleafTint[0]
        + cell.speciesDeadwood * config.material.deadwoodTint[0];
      speciesData[idx * 3 + 1] = cell.speciesPine * config.material.pineTint[1]
        + cell.speciesBroadleaf * config.material.broadleafTint[1]
        + cell.speciesDeadwood * config.material.deadwoodTint[1];
      speciesData[idx * 3 + 2] = cell.speciesPine * config.material.pineTint[2]
        + cell.speciesBroadleaf * config.material.broadleafTint[2]
        + cell.speciesDeadwood * config.material.deadwoodTint[2];
      roughnessData[idx] = clamp01(cell.crownRoughness);
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
