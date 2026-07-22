import type * as THREE from "three";

export interface PageCoord {
  px: number;
  pz: number;
  level?: number;
  centerX: number;
  centerZ: number;
}

export function streamingClodPageKey(px: number, pz: number, level = 0): string {
  return `L${Math.max(0, Math.floor(level))}:${px},${pz}`;
}

// Parsing happens O(cached²) per frame inside eviction sorts and active-root/coverage checks;
// memoize so steady-state frames do Map lookups instead of string splits + allocations.
const parsedPageKeyCache = new Map<string, { level: number; px: number; pz: number }>();
const PARSED_PAGE_KEY_CACHE_LIMIT = 8192;

export function parseStreamingClodPageKey(key: string): { level: number; px: number; pz: number } {
  const memo = parsedPageKeyCache.get(key);
  if (memo) return memo;
  const [levelText, coordText] = key.split(":");
  const [pxText, pzText] = (coordText ?? "").split(",");
  const level = Number(levelText?.startsWith("L") ? levelText.slice(1) : levelText);
  const px = Number(pxText);
  const pz = Number(pzText);
  if (!Number.isInteger(level) || !Number.isInteger(px) || !Number.isInteger(pz)) {
    throw new Error(`Invalid streaming CLOD page key ${key}`);
  }
  if (parsedPageKeyCache.size >= PARSED_PAGE_KEY_CACHE_LIMIT) parsedPageKeyCache.clear();
  const parsed = { level, px, pz };
  parsedPageKeyCache.set(key, parsed);
  return parsed;
}

export function coordLevel(coord: PageCoord): number {
  return Math.max(0, Math.floor(coord.level ?? 0));
}

export function pageLevel0Bounds(page: { level: number; px: number; pz: number }): {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
} {
  const scale = 2 ** page.level;
  return {
    minX: page.px * scale,
    minZ: page.pz * scale,
    maxX: (page.px + 1) * scale,
    maxZ: (page.pz + 1) * scale,
  };
}

export function pageContainsPage(ancestorKey: string, descendantKey: string): boolean {
  const ancestor = parseStreamingClodPageKey(ancestorKey);
  const descendant = parseStreamingClodPageKey(descendantKey);
  if (ancestor.level <= descendant.level) return false;
  const ancestorBounds = pageLevel0Bounds(ancestor);
  const descendantBounds = pageLevel0Bounds(descendant);
  return (
    descendantBounds.minX >= ancestorBounds.minX
    && descendantBounds.minZ >= ancestorBounds.minZ
    && descendantBounds.maxX <= ancestorBounds.maxX
    && descendantBounds.maxZ <= ancestorBounds.maxZ
  );
}

export function pageFullyCoveredByFinerCachedPages(pageKey: string, cachedKeys: Iterable<string>): boolean {
  const page = parseStreamingClodPageKey(pageKey);
  if (page.level <= 0) return false;
  const bounds = pageLevel0Bounds(page);
  const span = bounds.maxX - bounds.minX;
  const covered = new Set<number>();

  for (const key of cachedKeys) {
    if (key === pageKey) continue;
    const child = parseStreamingClodPageKey(key);
    if (child.level >= page.level) continue;
    const childBounds = pageLevel0Bounds(child);
    const minX = Math.max(bounds.minX, childBounds.minX);
    const minZ = Math.max(bounds.minZ, childBounds.minZ);
    const maxX = Math.min(bounds.maxX, childBounds.maxX);
    const maxZ = Math.min(bounds.maxZ, childBounds.maxZ);
    if (minX >= maxX || minZ >= maxZ) continue;
    for (let z = minZ; z < maxZ; z++) {
      for (let x = minX; x < maxX; x++) covered.add((z - bounds.minZ) * span + (x - bounds.minX));
    }
  }

  return covered.size === span * span;
}

export function pageCoveredByActiveRoots(pageKey: string, activeKeys: Iterable<string>): boolean {
  for (const activeKey of activeKeys) {
    if (activeKey === pageKey || pageContainsPage(activeKey, pageKey)) return true;
  }
  return pageFullyCoveredByFinerCachedPages(pageKey, activeKeys);
}

export function streamingClodPageHasRequiredNotReadyDescendant(
  pageKey: string,
  required: Iterable<string>,
  cached: ReadonlySet<string>,
): boolean {
  const parent = parseStreamingClodPageKey(pageKey);
  for (const key of required) {
    if (cached.has(key)) continue;
    const child = parseStreamingClodPageKey(key);
    if (parent.level <= child.level) continue;
    const scale = 2 ** (parent.level - child.level);
    if (Math.floor(child.px / scale) === parent.px && Math.floor(child.pz / scale) === parent.pz) return true;
  }
  return false;
}

export function sortStreamingClodPageCoordsForLoad(
  coords: readonly PageCoord[],
  center: Pick<THREE.Vector3, "x" | "z">,
): PageCoord[] {
  return [...coords].sort((a, b) => {
    const levelA = coordLevel(a);
    const levelB = coordLevel(b);
    if (levelA !== levelB) return levelB - levelA;
    const da = Math.hypot(center.x - a.centerX, center.z - a.centerZ);
    const db = Math.hypot(center.x - b.centerX, center.z - b.centerZ);
    return da - db || a.px - b.px || a.pz - b.pz;
  });
}

export function streamingClodRequiredPageCoords(
  center: Pick<THREE.Vector3, "x" | "z">,
  radiusM: number,
  pageSizeM: number,
  maxLevel = 0,
): PageCoord[] {
  const radius = Math.max(0, Number.isFinite(radiusM) ? radiusM : 0);
  const pageSize = Math.max(1, Number.isFinite(pageSizeM) ? pageSizeM : 1);
  const highestLevel = Math.max(0, Math.floor(maxLevel));
  const minPx = Math.floor((center.x - radius) / pageSize);
  const maxPx = Math.floor((center.x + radius) / pageSize);
  const minPz = Math.floor((center.z - radius) / pageSize);
  const maxPz = Math.floor((center.z + radius) / pageSize);
  const halfDiag = pageSize * Math.SQRT2 * 0.5;
  const coordsById = new Map<string, PageCoord>();

  for (let pz = minPz; pz <= maxPz; pz++) {
    for (let px = minPx; px <= maxPx; px++) {
      const centerX = (px + 0.5) * pageSize;
      const centerZ = (pz + 0.5) * pageSize;
      if (Math.hypot(center.x - centerX, center.z - centerZ) > radius + halfDiag) continue;
      for (let level = 0; level <= highestLevel; level++) {
        const scale = 2 ** level;
        const levelPx = Math.floor(px / scale);
        const levelPz = Math.floor(pz / scale);
        const levelPageSize = pageSize * scale;
        const key = streamingClodPageKey(levelPx, levelPz, level);
        if (coordsById.has(key)) continue;
        coordsById.set(key, {
          px: levelPx,
          pz: levelPz,
          level,
          centerX: (levelPx + 0.5) * levelPageSize,
          centerZ: (levelPz + 0.5) * levelPageSize,
        });
      }
    }
  }

  return sortStreamingClodPageCoordsForLoad([...coordsById.values()], center);
}

/** Returns the conservative radius whose required level-zero pages are ready. */
export function streamingReadyFrontierM(
  center: Pick<THREE.Vector3, "x" | "z">,
  radiusM: number,
  pageSizeM: number,
  required: readonly PageCoord[],
  refinedReadyIds: ReadonlySet<string>,
): number {
  const radius = Math.max(0, Number.isFinite(radiusM) ? radiusM : 0);
  const pageSize = Math.max(1, Number.isFinite(pageSizeM) ? pageSizeM : 1);
  const halfDiagonal = pageSize * Math.SQRT2 * 0.5;
  let frontier = radius;
  for (const coord of required) {
    if (coordLevel(coord) !== 0) continue;
    if (refinedReadyIds.has(streamingClodPageKey(coord.px, coord.pz, 0))) continue;
    frontier = Math.min(
      frontier,
      Math.max(0, Math.hypot(center.x - coord.centerX, center.z - coord.centerZ) - halfDiagonal),
    );
  }
  return frontier;
}

export function pageInsideFiniteStartupWorld(
  px: number,
  pz: number,
  worldPagesX: number,
  worldPagesZ: number,
  level = 0,
): boolean {
  const scale = 2 ** Math.max(0, Math.floor(level));
  const minX = px * scale;
  const minZ = pz * scale;
  return minX >= 0 && minZ >= 0 && minX + scale <= worldPagesX && minZ + scale <= worldPagesZ;
}
