import { TREE_SPECIES, type TreeSettings } from "./tree_config.js";
import {
  TREE_IMPOSTOR_MAX_ATLAS_VARIANTS,
  treeImpostorAgeBucketsForSettings,
  type TreeImpostorAtlas,
} from "./tree_impostor_baker.js";

const BYTES_PER_RGBA8_PIXEL = 4;
const TREE_IMPOSTOR_ATLAS_TEXTURES = 2;
const FULL_MIP_CHAIN_FACTOR = 4 / 3;
const BYTES_PER_MIB = 1024 * 1024;

export interface TreeImpostorAtlasMemoryStats {
  readyCount: number;
  targetCount: number;
  atlasSizePx: number;
  approximateMiB: number;
}

export function estimateTreeImpostorAtlasMemoryMiB(
  settings: TreeSettings,
  atlasCount: number = TREE_SPECIES.length,
): number {
  if (!settings.impostors.enabled) return 0;
  const atlasSizePx = settings.impostors.resolutionPx * settings.impostors.octahedralGridSize;
  const ageLayerCount = treeImpostorAgeBucketsForSettings(settings).length;
  const atlasHeightPx = atlasSizePx * TREE_IMPOSTOR_MAX_ATLAS_VARIANTS * ageLayerCount;
  const baseBytes = atlasSizePx
    * atlasHeightPx
    * BYTES_PER_RGBA8_PIXEL
    * TREE_IMPOSTOR_ATLAS_TEXTURES
    * atlasCount;
  return baseBytes * FULL_MIP_CHAIN_FACTOR / BYTES_PER_MIB;
}

export function treeImpostorAtlasMemoryStats(
  settings: TreeSettings,
  atlases: Partial<Record<string, TreeImpostorAtlas>>,
): TreeImpostorAtlasMemoryStats {
  const readyCount = Object.values(atlases).filter((atlas) => atlas?.ready).length;
  const targetCount = settings.impostors.enabled ? TREE_SPECIES.length : 0;
  return {
    readyCount,
    targetCount,
    atlasSizePx: settings.impostors.resolutionPx * settings.impostors.octahedralGridSize,
    approximateMiB: estimateTreeImpostorAtlasMemoryMiB(settings, targetCount),
  };
}
