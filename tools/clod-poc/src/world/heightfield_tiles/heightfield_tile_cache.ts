import {
  HEIGHTFIELD_TILE_BYTE_LENGTH,
  HEIGHTFIELD_TILE_RES,
  type HeightfieldTile,
} from "./heightfield_tile.js";
import type { HeightfieldTileConfig } from "./heightfield_tile_config.js";
import {
  tileKeyString,
  tileOriginM,
  worldToTile,
  type WorldTileKey,
  WORLD_TILE_SIZE_M,
} from "../tile_key.js";

export interface HeightfieldTileBuildResult {
  tiles: HeightfieldTile[];
  buildMs: number;
}

export type HeightfieldTileBatchBuilder = (
  keys: readonly WorldTileKey[],
  sourceRevision: number,
) => Promise<HeightfieldTileBuildResult>;

export interface HeightfieldTileStore {
  load(key: WorldTileKey, sourceRevision: number): Promise<HeightfieldTile | null>;
  save(tile: HeightfieldTile): Promise<void>;
}

export interface HeightfieldTileCacheUpdate {
  x: number;
  z: number;
  frameIndex: number;
  deltaSeconds?: number;
  velocityX?: number;
  velocityZ?: number;
  buildAllowed?: boolean;
}

export interface HeightfieldTileCacheCounters {
  enabled: number;
  resident: number;
  required: number;
  pending: number;
  inflight: number;
  buildsTotal: number;
  buildMsP95: number;
  evictionsTotal: number;
  fallbackSamplesTotal: number;
  bytesResident: number;
  storeHits: number;
  storeMisses: number;
  storeErrors: number;
  failuresTotal: number;
}

interface ResidentEntry {
  tile: HeightfieldTile;
  lastTouchFrame: number;
}

interface FailureState {
  retryAtFrame: number;
  attempts: number;
}

interface PlannedTile {
  key: WorldTileKey;
  id: string;
  distance: number;
}

const BUILD_SAMPLE_WINDOW = 120;

function percentile95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

function tileCenter(key: WorldTileKey): { x: number; z: number } {
  const origin = tileOriginM(key);
  return { x: origin.x + WORLD_TILE_SIZE_M * 0.5, z: origin.z + WORLD_TILE_SIZE_M * 0.5 };
}

export function planHeightfieldTileKeys(x: number, z: number, radiusM: number): PlannedTile[] {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radiusM) || radiusM < 0) {
    throw new Error("heightfield tile planning inputs must be finite and radius must be non-negative");
  }
  const min = worldToTile(x - radiusM - WORLD_TILE_SIZE_M, z - radiusM - WORLD_TILE_SIZE_M);
  const max = worldToTile(x + radiusM + WORLD_TILE_SIZE_M, z + radiusM + WORLD_TILE_SIZE_M);
  const halfDiagonal = WORLD_TILE_SIZE_M * Math.SQRT2 * 0.5;
  const planned: PlannedTile[] = [];

  for (let tz = min.z; tz <= max.z; tz++) {
    for (let tx = min.x; tx <= max.x; tx++) {
      const key = { x: tx, z: tz } as const;
      const center = tileCenter(key);
      const distance = Math.hypot(center.x - x, center.z - z);
      if (distance > radiusM + halfDiagonal) continue;
      planned.push({ key, id: tileKeyString(key), distance });
    }
  }

  return planned.sort((a, b) => a.distance - b.distance || a.key.z - b.key.z || a.key.x - b.key.x);
}

function assertTile(tile: HeightfieldTile, expectedKey: WorldTileKey, sourceRevision: number): void {
  if (tile.key.x !== expectedKey.x || tile.key.z !== expectedKey.z) {
    throw new Error(`heightfield tile builder returned ${tileKeyString(tile.key)} for ${tileKeyString(expectedKey)}`);
  }
  if (tile.res !== HEIGHTFIELD_TILE_RES || tile.heights.length !== HEIGHTFIELD_TILE_RES * HEIGHTFIELD_TILE_RES) {
    throw new Error(`heightfield tile ${tileKeyString(tile.key)} has invalid resolution`);
  }
  if (tile.sourceRevision !== sourceRevision) {
    throw new Error(`heightfield tile ${tileKeyString(tile.key)} source revision mismatch`);
  }
}

export class HeightfieldTileCache {
  private readonly resident = new Map<string, ResidentEntry>();
  private readonly inflightIds = new Set<string>();
  private readonly failures = new Map<string, FailureState>();
  private readonly buildSamples: number[] = [];
  private required = new Map<string, PlannedTile>();
  private previousCenter: { x: number; z: number; frameIndex: number } | null = null;
  private evictionCenter = { x: 0, z: 0 };
  private inflightBatches = 0;
  private currentFrame = 0;
  private epoch = 0;
  private buildAllowed = true;
  private buildsTotal = 0;
  private evictionsTotal = 0;
  private fallbackSamplesTotal = 0;
  private storeHits = 0;
  private storeMisses = 0;
  private storeErrors = 0;
  private failuresTotal = 0;

  constructor(
    readonly config: HeightfieldTileConfig,
    readonly sourceRevision: number,
    private readonly builder: HeightfieldTileBatchBuilder | null,
    private readonly store: HeightfieldTileStore | null = null,
  ) {}

  update(input: HeightfieldTileCacheUpdate): void {
    this.currentFrame = input.frameIndex;
    this.buildAllowed = input.buildAllowed !== false;
    const velocity = this.resolveVelocity(input);
    const predictedX = input.x + velocity.x * this.config.predictionSeconds;
    const predictedZ = input.z + velocity.z * this.config.predictionSeconds;
    this.evictionCenter = { x: predictedX, z: predictedZ };
    const planned = planHeightfieldTileKeys(predictedX, predictedZ, this.config.radiusM)
      .slice(0, this.config.maxResidentTiles);
    this.required = new Map(planned.map((entry) => [entry.id, entry]));

    for (const entry of planned) {
      const resident = this.resident.get(entry.id);
      if (resident) resident.lastTouchFrame = input.frameIndex;
    }

    this.evict(predictedX, predictedZ);
    this.dispatch();
    this.previousCenter = { x: input.x, z: input.z, frameIndex: input.frameIndex };
  }

  setBuildAllowed(allowed: boolean): void {
    this.buildAllowed = allowed;
    if (allowed) this.dispatch();
  }

  get(key: WorldTileKey): HeightfieldTile | null {
    const entry = this.resident.get(tileKeyString(key));
    if (!entry) return null;
    entry.lastTouchFrame = this.currentFrame;
    return entry.tile;
  }

  has(key: WorldTileKey): boolean {
    return this.resident.has(tileKeyString(key));
  }

  recordFallbackSample(count = 1): void {
    if (Number.isFinite(count) && count > 0) this.fallbackSamplesTotal += Math.floor(count);
  }

  counters(): HeightfieldTileCacheCounters {
    const pending = [...this.required.keys()].filter((id) => {
      if (this.resident.has(id) || this.inflightIds.has(id)) return false;
      const failure = this.failures.get(id);
      return !failure || failure.retryAtFrame <= this.currentFrame;
    }).length;
    return {
      enabled: 1,
      resident: this.resident.size,
      required: this.required.size,
      pending,
      inflight: this.inflightIds.size,
      buildsTotal: this.buildsTotal,
      buildMsP95: percentile95(this.buildSamples),
      evictionsTotal: this.evictionsTotal,
      fallbackSamplesTotal: this.fallbackSamplesTotal,
      bytesResident: this.resident.size * HEIGHTFIELD_TILE_BYTE_LENGTH,
      storeHits: this.storeHits,
      storeMisses: this.storeMisses,
      storeErrors: this.storeErrors,
      failuresTotal: this.failuresTotal,
    };
  }

  residentTiles(): readonly HeightfieldTile[] {
    return [...this.resident.values()].map((entry) => entry.tile);
  }

  clear(): void {
    this.epoch++;
    this.buildAllowed = false;
    this.resident.clear();
    this.required.clear();
    this.failures.clear();
    this.inflightIds.clear();
  }

  private resolveVelocity(input: HeightfieldTileCacheUpdate): { x: number; z: number } {
    if (Number.isFinite(input.velocityX) && Number.isFinite(input.velocityZ)) {
      return { x: input.velocityX!, z: input.velocityZ! };
    }
    if (!this.previousCenter) return { x: 0, z: 0 };
    const frameDelta = Math.max(1, input.frameIndex - this.previousCenter.frameIndex);
    const deltaSeconds = Number.isFinite(input.deltaSeconds) && input.deltaSeconds! > 0
      ? input.deltaSeconds! * frameDelta
      : frameDelta / 60;
    return {
      x: (input.x - this.previousCenter.x) / deltaSeconds,
      z: (input.z - this.previousCenter.z) / deltaSeconds,
    };
  }

  private evict(centerX: number, centerZ: number): void {
    const maxDistance = this.config.radiusM * this.config.evictDistanceMultiplier + WORLD_TILE_SIZE_M * Math.SQRT2;
    for (const [id, entry] of this.resident) {
      const center = tileCenter(entry.tile.key);
      if (this.required.has(id) || Math.hypot(center.x - centerX, center.z - centerZ) <= maxDistance) continue;
      this.resident.delete(id);
      this.evictionsTotal++;
    }

    if (this.resident.size <= this.config.maxResidentTiles) return;
    const lru = [...this.resident.entries()]
      .filter(([id]) => !this.required.has(id))
      .sort((a, b) => a[1].lastTouchFrame - b[1].lastTouchFrame);
    while (this.resident.size > this.config.maxResidentTiles && lru.length > 0) {
      const [id] = lru.shift()!;
      if (this.resident.delete(id)) this.evictionsTotal++;
    }
  }

  private dispatch(): void {
    if (!this.buildAllowed || !this.builder || this.inflightBatches >= this.config.maxInflightBatches) return;
    const candidates = [...this.required.values()].filter((entry) => {
      if (this.resident.has(entry.id) || this.inflightIds.has(entry.id)) return false;
      const failure = this.failures.get(entry.id);
      return !failure || failure.retryAtFrame <= this.currentFrame;
    });
    if (candidates.length === 0) return;

    const batch = candidates.slice(0, this.config.maxTilesPerBatch);
    const epoch = this.epoch;
    for (const entry of batch) this.inflightIds.add(entry.id);
    this.inflightBatches++;
    void this.loadOrBuild(batch, epoch).finally(() => {
      for (const entry of batch) this.inflightIds.delete(entry.id);
      this.inflightBatches = Math.max(0, this.inflightBatches - 1);
      if (epoch === this.epoch) this.dispatch();
    });
  }

  private async loadOrBuild(batch: readonly PlannedTile[], epoch: number): Promise<void> {
    const loaded = new Map<string, HeightfieldTile>();
    const misses: PlannedTile[] = [];

    if (this.store) {
      for (const entry of batch) {
        try {
          const tile = await this.store.load(entry.key, this.sourceRevision);
          if (epoch !== this.epoch) return;
          if (tile) {
            assertTile(tile, entry.key, this.sourceRevision);
            loaded.set(entry.id, tile);
            this.storeHits++;
          } else {
            this.storeMisses++;
            misses.push(entry);
          }
        } catch {
          if (epoch !== this.epoch) return;
          this.storeErrors++;
          misses.push(entry);
        }
      }
    } else {
      misses.push(...batch);
    }

    if (epoch !== this.epoch) return;
    for (const [id, tile] of loaded) this.install(id, tile);
    if (misses.length === 0) return;

    try {
      const built = await this.builder!(misses.map((entry) => entry.key), this.sourceRevision);
      if (epoch !== this.epoch) return;
      if (built.tiles.length !== misses.length) {
        throw new Error(`heightfield tile builder returned ${built.tiles.length} tiles for ${misses.length} requests`);
      }
      this.buildSamples.push(built.buildMs);
      if (this.buildSamples.length > BUILD_SAMPLE_WINDOW) this.buildSamples.shift();
      const byId = new Map(built.tiles.map((tile) => [tileKeyString(tile.key), tile]));
      for (const entry of misses) {
        const tile = byId.get(entry.id);
        if (!tile) throw new Error(`heightfield tile builder omitted ${entry.id}`);
        assertTile(tile, entry.key, this.sourceRevision);
        this.install(entry.id, tile);
        this.buildsTotal++;
        this.failures.delete(entry.id);
        if (this.store) {
          void this.store.save(tile).catch(() => {
            if (epoch === this.epoch) this.storeErrors++;
          });
        }
      }
    } catch {
      if (epoch !== this.epoch) return;
      this.failuresTotal += misses.length;
      for (const entry of misses) {
        const previous = this.failures.get(entry.id);
        this.failures.set(entry.id, {
          attempts: (previous?.attempts ?? 0) + 1,
          retryAtFrame: this.currentFrame + this.config.retryCooldownFrames,
        });
      }
    }
  }

  private install(id: string, tile: HeightfieldTile): void {
    this.resident.set(id, { tile, lastTouchFrame: this.currentFrame });
    if (this.resident.size > this.config.maxResidentTiles) {
      this.evict(this.evictionCenter.x, this.evictionCenter.z);
    }
  }
}
