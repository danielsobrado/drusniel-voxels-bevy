import { decodeMacroAtlas, type AzgaarMacroWorldSource } from "./azgaar_macro_world_source.js";
import type { AzgaarBiomeDefinition } from "./azgaar_biome_catalog.js";

export interface AzgaarProceduralMetadata {
  seed: number;
  version: number;
  heightScale: number;
  seaLevel: number;
}

interface RiverSegment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  width: number;
}

interface AzgaarTileDefinition {
  id: number;
  key: string;
  label: string;
  color: string;
  icon: string;
  terrainClass: AzgaarBiomeDefinition["terrainClass"];
  supportsGrass: boolean;
  supportsTrees: boolean;
  azgaarSourceId: number;
}

export interface AzgaarMacroColumn {
  height: number;
  tileId: number;
}

const WATER_TILE_ID = 0;
const LAND_HEIGHT = 20;
const MOUNTAIN_RUGGEDNESS = 0.25;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function lerp(left: number, right: number, amount: number): number {
  return left + (right - left) * amount;
}

function smoothstep(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function hash2d(x: number, z: number, seed: number): number {
  let value = Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(z | 0, 0x5f356495) ^ (seed | 0);
  value = Math.imul(value ^ (value >>> 15), 0x2c1b3c6d);
  value = Math.imul(value ^ (value >>> 12), 0x297a2d39);
  value ^= value >>> 15;
  return (value >>> 0) / 0xffffffff;
}

function valueNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = smoothstep(x - x0);
  const tz = smoothstep(z - z0);
  const north = lerp(hash2d(x0, z0, seed), hash2d(x0 + 1, z0, seed), tx);
  const south = lerp(hash2d(x0, z0 + 1, seed), hash2d(x0 + 1, z0 + 1, seed), tx);
  return lerp(north, south, tz) * 2 - 1;
}

function pointSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  const amount = clamp(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0, 1);
  return Math.hypot(px - (ax + dx * amount), py - (ay + dy * amount));
}

function landReliefFraction(
  rawHeight: number,
  terrain: AzgaarMacroWorldSource["terrain"],
): number {
  const normalized = clamp((rawHeight - LAND_HEIGHT) / (100 - LAND_HEIGHT), 0, 1);
  return terrain.reliefExponent === 1 ? normalized : normalized ** terrain.reliefExponent;
}

function convertHeight(
  rawHeight: number,
  terrain: AzgaarMacroWorldSource["terrain"],
): number {
  if (rawHeight < LAND_HEIGHT) {
    return terrain.minHeight * clamp((LAND_HEIGHT - rawHeight) / LAND_HEIGHT, 0, 1) * 0.35;
  }
  return landReliefFraction(rawHeight, terrain)
    * terrain.maxHeight
    * 0.85
    * terrain.verticalExaggeration;
}

function createRiverIndex(
  rivers: AzgaarMacroWorldSource["rivers"],
  width: number,
  height: number,
): Map<string, RiverSegment[]> {
  const buckets = new Map<string, RiverSegment[]>();
  for (const river of rivers) {
    for (let index = 1; index < river.points.length; index += 1) {
      const previous = river.points[index - 1];
      const current = river.points[index];
      if (!previous || !current) continue;
      const [ax, ay] = previous;
      const [bx, by] = current;
      const segment: RiverSegment = { ax, ay, bx, by, width: river.widthAtlas };
      const margin = Math.max(0.5, river.widthAtlas);
      const minX = clamp(Math.floor(Math.min(ax, bx) - margin), 0, width - 1);
      const maxX = clamp(Math.floor(Math.max(ax, bx) + margin), 0, width - 1);
      const minY = clamp(Math.floor(Math.min(ay, by) - margin), 0, height - 1);
      const maxY = clamp(Math.floor(Math.max(ay, by) + margin), 0, height - 1);
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const key = `${x}:${y}`;
          const entries = buckets.get(key) ?? [];
          entries.push(segment);
          buckets.set(key, entries);
        }
      }
    }
  }
  return buckets;
}

function validateBiomeDefinitions(definitions: readonly AzgaarBiomeDefinition[]): void {
  if (definitions.length < 13) {
    throw new Error('Azgaar macro source must include its biome definitions.');
  }
  const sourceIds = new Set<number>();
  const tileIds = new Set<number>();
  for (const definition of definitions) {
    if (
      !Number.isInteger(definition.sourceId)
      || definition.sourceId < 0
      || definition.sourceId > 255
      || sourceIds.has(definition.sourceId)
    ) {
      throw new Error('Azgaar macro source has invalid or duplicate biome source ids.');
    }
    if (
      !Number.isInteger(definition.tileId)
      || definition.tileId < 0
      || definition.tileId > 254
      || (definition.sourceId >= 13 && definition.tileId < 32)
      || tileIds.has(definition.tileId)
    ) {
      throw new Error('Azgaar macro source has invalid or duplicate biome terrain ids.');
    }
    if (
      definition.name.trim() === ''
      || !/^#[0-9a-f]{6}$/i.test(definition.color)
    ) {
      throw new Error(`Azgaar macro source has invalid metadata for biome ${definition.sourceId}.`);
    }
    sourceIds.add(definition.sourceId);
    tileIds.add(definition.tileId);
  }
  for (let sourceId = 0; sourceId < 13; sourceId += 1) {
    const definition = definitions.find((entry) => entry.sourceId === sourceId);
    if (!definition || definition.tileId !== sourceId || definition.standard !== true) {
      throw new Error('Azgaar standard biome ids must map directly to terrain ids 0–12.');
    }
  }
}

export class AzgaarMacroWorldGenerator {
  readonly source: AzgaarMacroWorldSource;
  readonly seed: number;
  readonly version: number;
  readonly heightScale: number;
  readonly seaLevel: number;

  private readonly heights: Uint8Array;
  private readonly biomeAtlas: Uint8Array;
  private readonly biomeBySourceId: Map<number, AzgaarBiomeDefinition>;
  private readonly tileDefinitionById: Map<number, Readonly<AzgaarTileDefinition>>;
  private readonly riverIndex: Map<string, RiverSegment[]>;

  constructor(source: AzgaarMacroWorldSource, proceduralMetadata: AzgaarProceduralMetadata) {
    const decoded = decodeMacroAtlas(source);
    validateBiomeDefinitions(source.biomes);
    this.source = source;
    this.heights = decoded.heights;
    this.biomeAtlas = decoded.biomes;
    this.biomeBySourceId = new Map(
      source.biomes.map((definition) => [definition.sourceId, definition]),
    );
    this.tileDefinitionById = new Map(source.biomes.map((definition) => [
      definition.tileId,
      Object.freeze({
        id: definition.tileId,
        key: definition.key,
        label: definition.name,
        color: definition.color,
        icon: definition.icon,
        terrainClass: definition.terrainClass,
        supportsGrass: definition.supportsGrass,
        supportsTrees: definition.supportsTrees,
        azgaarSourceId: definition.sourceId,
      }),
    ]));
    for (const sourceId of new Set(this.biomeAtlas)) {
      if (!this.biomeBySourceId.has(sourceId)) {
        throw new Error(`Azgaar macro source has no definition for biome ${sourceId}.`);
      }
    }
    this.seed = proceduralMetadata.seed;
    this.version = proceduralMetadata.version;
    this.heightScale = proceduralMetadata.heightScale;
    this.seaLevel = proceduralMetadata.seaLevel;
    this.riverIndex = createRiverIndex(
      source.rivers,
      source.atlas.width,
      source.atlas.height,
    );
  }

  toMetadata(): Readonly<AzgaarProceduralMetadata> {
    return Object.freeze({
      seed: this.seed,
      version: this.version,
      heightScale: this.heightScale,
      seaLevel: this.seaLevel,
    });
  }

  toBaseTerrain(): AzgaarMacroWorldSource {
    return structuredClone(this.source);
  }

  getTileDefinition(tileId: number): Readonly<AzgaarTileDefinition> | null {
    return this.tileDefinitionById.get(tileId) ?? null;
  }

  getSurfaceMaskConfig<T extends object>(
    maskConfig: T,
  ): T & { waterTileId: number; grassTileIds: number[] } {
    return {
      ...maskConfig,
      waterTileId: WATER_TILE_ID,
      grassTileIds: this.source.biomes
        .filter((definition) => definition.supportsGrass)
        .map((definition) => definition.tileId),
    };
  }

  toAtlasPosition(cellX: number, cellZ: number): { x: number; y: number } {
    const { bounds, atlas } = this.source;
    return {
      x: (cellX - bounds.minCellX) / bounds.widthCells * atlas.width,
      y: (cellZ - bounds.minCellZ) / bounds.heightCells * atlas.height,
    };
  }

  isInside(cellX: number, cellZ: number): boolean {
    const { bounds } = this.source;
    return cellX >= bounds.minCellX
      && cellZ >= bounds.minCellZ
      && cellX < bounds.minCellX + bounds.widthCells
      && cellZ < bounds.minCellZ + bounds.heightCells;
  }

  atlasIndex(x: number, y: number): number {
    const { width, height } = this.source.atlas;
    const clampedX = clamp(x, 0, width - 1);
    const clampedY = clamp(y, 0, height - 1);
    return clampedY * width + clampedX;
  }

  sampleRawHeight(cellX: number, cellZ: number): number {
    const { width, height } = this.source.atlas;
    const position = this.toAtlasPosition(cellX, cellZ);
    const fx = clamp(position.x - 0.5, 0, width - 1);
    const fy = clamp(position.y - 0.5, 0, height - 1);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const north = lerp(
      this.heights[this.atlasIndex(x0, y0)] ?? 0,
      this.heights[this.atlasIndex(x1, y0)] ?? 0,
      fx - x0,
    );
    const south = lerp(
      this.heights[this.atlasIndex(x0, y1)] ?? 0,
      this.heights[this.atlasIndex(x1, y1)] ?? 0,
      fx - x0,
    );
    return lerp(north, south, fy - y0);
  }

  outsideDistance(cellX: number, cellZ: number): number {
    const { bounds } = this.source;
    const maxX = bounds.minCellX + bounds.widthCells;
    const maxZ = bounds.minCellZ + bounds.heightCells;
    return Math.hypot(
      Math.max(bounds.minCellX - cellX, 0, cellX - maxX),
      Math.max(bounds.minCellZ - cellZ, 0, cellZ - maxZ),
    );
  }

  sampleHeight(vertexX: number, vertexZ: number): number {
    const rawHeight = this.sampleRawHeight(vertexX, vertexZ);
    const base = convertHeight(rawHeight, this.source.terrain);
    if (!this.isInside(vertexX, vertexZ)) {
      const amount = smoothstep(
        this.outsideDistance(vertexX, vertexZ) / this.source.oceanTransitionCells,
      );
      return lerp(base, this.source.terrain.minHeight * 0.35, amount);
    }
    if (rawHeight < LAND_HEIGHT) return base;
    const coastFade = clamp((rawHeight - LAND_HEIGHT) / 10, 0, 1);
    const exaggeration = this.source.terrain.verticalExaggeration;
    const elevationFraction = landReliefFraction(rawHeight, this.source.terrain);
    const ruggedness = 1 + (exaggeration - 1) * elevationFraction * MOUNTAIN_RUGGEDNESS;
    const detail = (
      valueNoise(vertexX / 96, vertexZ / 96, this.seed + 1709) * 1.4
      + valueNoise(vertexX / 24, vertexZ / 24, this.seed + 1877) * 0.35
    );
    return base + detail * coastFade * ruggedness;
  }

  sampleMacroColumn(cellX: number, cellZ: number): AzgaarMacroColumn {
    const rawHeight = this.sampleRawHeight(cellX, cellZ);
    let height = convertHeight(rawHeight, this.source.terrain);
    if (!this.isInside(cellX, cellZ)) {
      const amount = smoothstep(
        this.outsideDistance(cellX, cellZ) / this.source.oceanTransitionCells,
      );
      height = lerp(height, this.source.terrain.minHeight * 0.35, amount);
    }
    return { height, tileId: this.sampleTile(cellX, cellZ) };
  }

  isRiver(cellX: number, cellZ: number): boolean {
    const position = this.toAtlasPosition(cellX + 0.5, cellZ + 0.5);
    const key = `${Math.floor(position.x)}:${Math.floor(position.y)}`;
    const segments = this.riverIndex.get(key);
    if (!segments) return false;
    return segments.some((segment) => pointSegmentDistance(
      position.x,
      position.y,
      segment.ax,
      segment.ay,
      segment.bx,
      segment.by,
    ) <= segment.width * 0.5);
  }

  sampleTile(cellX: number, cellZ: number): number {
    if (!this.isInside(cellX + 0.5, cellZ + 0.5)) return WATER_TILE_ID;
    const position = this.toAtlasPosition(cellX + 0.5, cellZ + 0.5);
    const index = this.atlasIndex(Math.floor(position.x), Math.floor(position.y));
    const rawHeight = this.heights[index] ?? 0;
    if (rawHeight >= LAND_HEIGHT && this.isRiver(cellX, cellZ)) return WATER_TILE_ID;
    if (rawHeight < LAND_HEIGHT) return WATER_TILE_ID;
    return this.biomeBySourceId.get(this.biomeAtlas[index] ?? 0)?.tileId ?? WATER_TILE_ID;
  }
}
