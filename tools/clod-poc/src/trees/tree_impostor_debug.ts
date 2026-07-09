import type { TreeSpeciesId } from "./tree_config.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";

export interface TreeImpostorAtlasDebugStatus {
  species: TreeSpeciesId;
  ready: boolean;
  gridSize: number;
  resolutionPx: number;
  atlasWidthPx: number;
  atlasHeightPx: number;
  variantCount: number;
  frameCount: number;
  hasAlbedo: boolean;
  hasNormalDepth: boolean;
  radius: number | null;
  centerY: number | null;
}

export type TreeImpostorDebugStatus = Partial<Record<TreeSpeciesId, TreeImpostorAtlasDebugStatus>>;

declare global {
  interface Window {
    __drusnielTreeImpostors?: TreeImpostorDebugStatus;
  }
}

export function publishTreeImpostorDebugStatus(
  atlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>,
): TreeImpostorDebugStatus {
  const status: TreeImpostorDebugStatus = {};
  for (const atlas of Object.values(atlases)) {
    if (!atlas) continue;
    status[atlas.species] = {
      species: atlas.species,
      ready: atlas.ready,
      gridSize: atlas.gridSize,
      resolutionPx: atlas.resolutionPx,
      atlasWidthPx: atlas.atlasWidthPx ?? atlas.atlasSizePx,
      atlasHeightPx: atlas.atlasHeightPx ?? atlas.atlasSizePx,
      variantCount: Math.max(1, Math.floor(atlas.variantCount ?? 1)),
      frameCount: atlas.frames.length,
      hasAlbedo: !!(atlas.albedo ?? atlas.texture),
      hasNormalDepth: !!atlas.normalDepth,
      radius: Number.isFinite(atlas.radius) ? atlas.radius ?? null : null,
      centerY: Number.isFinite(atlas.centerY) ? atlas.centerY ?? null : null,
    };
  }
  if (typeof window !== "undefined") window.__drusnielTreeImpostors = status;
  return status;
}
