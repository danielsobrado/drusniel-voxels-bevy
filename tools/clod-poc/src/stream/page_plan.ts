import { isVisualPageDistance } from "./page_filter.js";
import { pageRangeForRadius } from "./page_range.js";

export interface VisualPageStreamerConfig {
  pageSizeM: number;
  maxLevel: number;
  hysteresisM: number;
}

export interface VisualPageStreamerSnapshot {
  center: { x: number; z: number };
  required: readonly string[];
  loaded: readonly string[];
  evictable: readonly string[];
}

export function pageKey(level: number, x: number, z: number): string {
  return String(level) + ":" + String(x) + "," + String(z);
}

const PACK_PAGE_COORD_OFFSET = 1_048_576;
const PACK_PAGE_COORD_STRIDE = PACK_PAGE_COORD_OFFSET * 2;
const PACK_PAGE_LEVEL_STRIDE = PACK_PAGE_COORD_STRIDE * PACK_PAGE_COORD_STRIDE;

export function packPageKey(level: number, x: number, z: number): number {
  return level * PACK_PAGE_LEVEL_STRIDE + (x + PACK_PAGE_COORD_OFFSET) * PACK_PAGE_COORD_STRIDE + (z + PACK_PAGE_COORD_OFFSET);
}

export function pageCenterX(x: number, pageSize: number): number {
  return (x + 0.5) * pageSize;
}

export function pageCenterZ(z: number, pageSize: number): number {
  return (z + 0.5) * pageSize;
}

export function visualPageKeys(centerX: number, centerZ: number, liveRadiusM: number, clodRadiusM: number, pageSizeM: number, maxLevel: number): string[] {
  const keys = new Set<string>();
  for (let level = 0; level <= maxLevel; level++) {
    const levelPageSize = pageSizeM * 2 ** level;
    const range = pageRangeForRadius(centerX, centerZ, clodRadiusM, levelPageSize);
    for (let x = range.minX; x <= range.maxX; x++) {
      for (let z = range.minZ; z <= range.maxZ; z++) {
        const dx = pageCenterX(x, levelPageSize) - centerX;
        const dz = pageCenterZ(z, levelPageSize) - centerZ;
        const distance = Math.sqrt(dx * dx + dz * dz);
        if (isVisualPageDistance(distance, liveRadiusM, clodRadiusM, levelPageSize)) keys.add(pageKey(level, x, z));
      }
    }
  }
  return sortVisualPageKeysForLoad(Array.from(keys), centerX, centerZ, pageSizeM);
}

export function parsePageKey(key: string): { level: number; x: number; z: number } {
  const [levelText, coordText] = key.split(":");
  const [xText, zText] = (coordText ?? "").split(",");
  const level = Number(levelText);
  const x = Number(xText);
  const z = Number(zText);
  if (!Number.isInteger(level) || !Number.isInteger(x) || !Number.isInteger(z)) throw new Error(`Invalid visual page key ${key}`);
  return { level, x, z };
}

export function sortVisualPageKeysForLoad(keys: readonly string[], centerX: number, centerZ: number, pageSizeM: number): string[] {
  return [...keys].sort((a, b) => {
    const ca = parsePageKey(a);
    const cb = parsePageKey(b);
    if (ca.level !== cb.level) return cb.level - ca.level;
    const sizeA = pageSizeM * 2 ** ca.level;
    const sizeB = pageSizeM * 2 ** cb.level;
    const da = Math.hypot(pageCenterX(ca.x, sizeA) - centerX, pageCenterZ(ca.z, sizeA) - centerZ);
    const db = Math.hypot(pageCenterX(cb.x, sizeB) - centerX, pageCenterZ(cb.z, sizeB) - centerZ);
    return da - db || ca.z - cb.z || ca.x - cb.x;
  });
}

function isAncestorPage(ancestor: { level: number; x: number; z: number }, descendant: { level: number; x: number; z: number }): boolean {
  if (ancestor.level <= descendant.level) return false;
  const scale = 2 ** (ancestor.level - descendant.level);
  return Math.floor(descendant.x / scale) === ancestor.x && Math.floor(descendant.z / scale) === ancestor.z;
}

export function pageHasRequiredNotReadyDescendant(page: string, required: Iterable<string>, loaded: ReadonlySet<string>): boolean {
  const parent = parsePageKey(page);
  for (const key of required) {
    if (loaded.has(key)) continue;
    if (isAncestorPage(parent, parsePageKey(key))) return true;
  }
  return false;
}

function evictableVisualPageKeys(loaded: Iterable<string>, required: Iterable<string>, centerX: number, centerZ: number, clodRadiusM: number, config: VisualPageStreamerConfig): string[] {
  const evictable: string[] = [];
  const radius = clodRadiusM + config.hysteresisM;
  const loadedSet = new Set(loaded);
  for (const key of loaded) {
    const coord = parsePageKey(key);
    const pageSize = config.pageSizeM * 2 ** coord.level;
    const dx = pageCenterX(coord.x, pageSize) - centerX;
    const dz = pageCenterZ(coord.z, pageSize) - centerZ;
    if (
      Math.sqrt(dx * dx + dz * dz) > radius + pageSize * Math.SQRT2 * 0.5 &&
      !pageHasRequiredNotReadyDescendant(key, required, loadedSet)
    ) {
      evictable.push(key);
    }
  }
  return evictable.sort();
}

export class VisualClodPageStreamer {
  private center = { x: 0, z: 0 };
  private readonly loaded = new Set<string>();

  constructor(
    private readonly liveRadiusM: number,
    private readonly clodRadiusM: number,
    private readonly config: VisualPageStreamerConfig,
  ) {}

  update(centerX: number, centerZ: number): VisualPageStreamerSnapshot {
    this.center = { x: centerX, z: centerZ };
    const required = visualPageKeys(centerX, centerZ, this.liveRadiusM, this.clodRadiusM, this.config.pageSizeM, this.config.maxLevel);
    for (const key of required) this.loaded.add(key);
    const evictable = evictableVisualPageKeys(this.loaded, required, centerX, centerZ, this.clodRadiusM, this.config);
    for (const key of evictable) this.loaded.delete(key);
    return {
      center: { ...this.center },
      required,
      loaded: sortVisualPageKeysForLoad([...this.loaded], centerX, centerZ, this.config.pageSizeM),
      evictable,
    };
  }

  snapshot(): VisualPageStreamerSnapshot {
    const required = visualPageKeys(this.center.x, this.center.z, this.liveRadiusM, this.clodRadiusM, this.config.pageSizeM, this.config.maxLevel);
    return {
      center: { ...this.center },
      required,
      loaded: sortVisualPageKeysForLoad([...this.loaded], this.center.x, this.center.z, this.config.pageSizeM),
      evictable: evictableVisualPageKeys(
        this.loaded,
        required,
        this.center.x,
        this.center.z,
        this.clodRadiusM,
        this.config,
      ),
    };
  }
}
