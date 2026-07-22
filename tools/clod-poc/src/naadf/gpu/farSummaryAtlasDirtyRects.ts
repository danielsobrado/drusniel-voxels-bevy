import type { ResolvedFarSummaryGpuAtlasUploadOptions } from "../farSummaryAtlasUploadConfig.js";

export type FarSummaryGpuAtlasFullUploadReason =
  | "initial"
  | "explicit"
  | "disabled"
  | "too_many_rects"
  | "threshold"
  | "invalid_atlas"
  | "partial_ranges_unsupported"
  | "full_invalidation";

export interface AtlasDirtyRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AtlasDirtyUploadPlan {
  rects: AtlasDirtyRect[];
  dirtyPixels: number;
  fullUpload: boolean;
}

export interface PlannedAtlasTileSnapshot {
  key: string;
  revision: number;
  ringIndex: number;
  atlasTileX: number;
  atlasTileZ: number;
  atlasX: number;
  atlasY: number;
  copyCells: number;
}

export interface AtlasPlacementDiff {
  clearRects: AtlasDirtyRect[];
  blitKeys: string[];
}

export function mergeDirtyRects(rects: AtlasDirtyRect[]): AtlasDirtyRect[] {
  const merged = rects
    .map(normalizeRect)
    .filter((rect): rect is AtlasDirtyRect => rect !== null);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < merged.length && !changed; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        if (!rectsOverlapOrTouch(merged[i]!, merged[j]!)) continue;
        merged[i] = unionRect(merged[i]!, merged[j]!);
        merged.splice(j, 1);
        changed = true;
        break;
      }
    }
  }
  return merged;
}

export function dirtyArea(rects: AtlasDirtyRect[]): number {
  return mergeDirtyRects(rects).reduce((total, rect) => total + rect.width * rect.height, 0);
}

export function resolveFullUploadReason(
  plan: AtlasDirtyUploadPlan,
  atlasPixels: number,
  config: ResolvedFarSummaryGpuAtlasUploadOptions,
  partialRangesSupported = true,
): FarSummaryGpuAtlasFullUploadReason | null {
  if (plan.fullUpload) return "explicit";
  if (!config.dirtyRectUploads) return "disabled";
  if (!partialRangesSupported) return "partial_ranges_unsupported";
  if (plan.rects.length > config.maxDirtyRectsPerTexture) return "too_many_rects";
  if (atlasPixels <= 0) return "invalid_atlas";
  if (plan.dirtyPixels / atlasPixels > config.fullUploadThresholdPct) return "threshold";
  return null;
}

export function shouldUseFullUpload(
  plan: AtlasDirtyUploadPlan,
  atlasPixels: number,
  config: ResolvedFarSummaryGpuAtlasUploadOptions,
): boolean {
  return resolveFullUploadReason(plan, atlasPixels, config) !== null;
}

export function diffAtlasTilePlacements(
  previous: ReadonlyMap<string, PlannedAtlasTileSnapshot>,
  next: ReadonlyMap<string, PlannedAtlasTileSnapshot>,
  forceBlitAll = false,
): AtlasPlacementDiff {
  const clearRects: AtlasDirtyRect[] = [];
  const blitKeys: string[] = [];

  for (const [key, oldPlacement] of previous) {
    const nextPlacement = next.get(key);
    if (!nextPlacement) {
      clearRects.push(snapshotRect(oldPlacement));
      continue;
    }
    if (sameAtlasSlot(oldPlacement, nextPlacement) && oldPlacement.copyCells === nextPlacement.copyCells) continue;
    clearRects.push(snapshotRect(oldPlacement));
  }

  for (const [key, nextPlacement] of next) {
    const oldPlacement = previous.get(key);
    if (
      forceBlitAll
      || !oldPlacement
      || oldPlacement.revision !== nextPlacement.revision
      || !sameAtlasSlot(oldPlacement, nextPlacement)
      || oldPlacement.copyCells !== nextPlacement.copyCells
    ) {
      blitKeys.push(key);
    }
  }

  return { clearRects, blitKeys };
}

export function clipRect(rect: AtlasDirtyRect, width: number, height: number): AtlasDirtyRect | null {
  const normalized = normalizeRect(rect);
  if (!normalized) return null;
  const x = Math.max(0, Math.min(width, normalized.x));
  const y = Math.max(0, Math.min(height, normalized.y));
  const maxX = Math.max(0, Math.min(width, normalized.x + normalized.width));
  const maxY = Math.max(0, Math.min(height, normalized.y + normalized.height));
  if (maxX <= x || maxY <= y) return null;
  return { x, y, width: maxX - x, height: maxY - y };
}

function snapshotRect(tile: PlannedAtlasTileSnapshot): AtlasDirtyRect {
  return { x: tile.atlasX, y: tile.atlasY, width: tile.copyCells, height: tile.copyCells };
}

function sameAtlasSlot(a: PlannedAtlasTileSnapshot, b: PlannedAtlasTileSnapshot): boolean {
  return a.ringIndex === b.ringIndex
    && a.atlasTileX === b.atlasTileX
    && a.atlasTileZ === b.atlasTileZ
    && a.atlasX === b.atlasX
    && a.atlasY === b.atlasY;
}

function normalizeRect(rect: AtlasDirtyRect): AtlasDirtyRect | null {
  const x = Math.floor(rect.x);
  const y = Math.floor(rect.y);
  const width = Math.floor(rect.width);
  const height = Math.floor(rect.height);
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function rectsOverlapOrTouch(a: AtlasDirtyRect, b: AtlasDirtyRect): boolean {
  return a.x <= b.x + b.width
    && b.x <= a.x + a.width
    && a.y <= b.y + b.height
    && b.y <= a.y + a.height;
}

function unionRect(a: AtlasDirtyRect, b: AtlasDirtyRect): AtlasDirtyRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: maxX - x, height: maxY - y };
}
