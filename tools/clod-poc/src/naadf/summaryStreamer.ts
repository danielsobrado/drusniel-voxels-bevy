import type {
  ChunkKey,
  ResidentChunkEntry,
  SummaryStreamingUpdate,
  SummaryTileKey,
} from "./types.js";
import type { NaadfPocConfig } from "./config.js";
import type { TerrainSource } from "./terrainSource.js";
import { buildChunkBrick } from "./chunkBrick.js";
import { buildMipChain } from "./mipBuilder.js";
import {
  createNearPageTable,
  enumerateNearTableChunks,
  recenterNearPageTable,
  type NearPageTable,
} from "./nearPageTable.js";
import { createHashFallback, type HashFallback } from "./hashFallback.js";
import {
  buildFarSummaryTile,
  farTileKeyString,
  type FarClipmapStore,
} from "./farClipmap.js";
import { worldToChunkKey, worldToSummaryTileKey, chunkKeyToString } from "./keys.js";
import type { NaadfMetricsCollector } from "./metrics.js";
import { chunkKeyEquals } from "./keys.js";
import {
  isChunkQueryable,
  syncResidentLookupTables,
} from "./residentLookup.js";

type StreamJob = {
  kind: "chunk" | "far_tile";
  priority: number;
  key: ChunkKey | SummaryTileKey;
  ringIndex?: number;
};

export type NaadfWorldState = {
  config: NaadfPocConfig;
  source: TerrainSource;
  residents: ResidentChunkEntry[];
  residentIndexByKey: Map<string, number>;
  nearTable: NearPageTable;
  hashFallback: HashFallback;
  farTiles: FarClipmapStore;
  farTileLastTouched: Map<string, number>;
  pendingJobs: Map<string, StreamJob>;
  cameraX: number;
  cameraZ: number;
  velocityX: number;
  velocityZ: number;
  predictedX: number;
  predictedZ: number;
  frame: number;
  revision: number;
  forceMissingStress: boolean;
  metrics: NaadfMetricsCollector;
};

export function createNaadfWorldState(
  config: NaadfPocConfig,
  source: TerrainSource,
  metrics: NaadfMetricsCollector,
  forceMissingStress = false,
): NaadfWorldState {
  return {
    config,
    source,
    residents: [],
    residentIndexByKey: new Map(),
    nearTable: createNearPageTable(config.nearPageTable.radiusChunksXz),
    hashFallback: createHashFallback(config.hashFallback.capacity),
    farTiles: new Map(),
    farTileLastTouched: new Map(),
    pendingJobs: new Map(),
    cameraX: 0,
    cameraZ: 0,
    velocityX: 0,
    velocityZ: 0,
    predictedX: 0,
    predictedZ: 0,
    frame: 0,
    revision: 0,
    forceMissingStress,
    metrics,
  };
}

function findResident(state: NaadfWorldState, key: ChunkKey): ResidentChunkEntry | null {
  const idx = state.residentIndexByKey.get(chunkKeyToString(key));
  if (idx === undefined) return null;
  return state.residents[idx] ?? null;
}

function ensureResident(state: NaadfWorldState, key: ChunkKey, frame: number): ResidentChunkEntry {
  const existing = findResident(state, key);
  if (existing) {
    existing.lastTouchedFrame = frame;
    return existing;
  }
  const entry: ResidentChunkEntry = {
    key,
    state: "requested",
    brick: null,
    mipChain: null,
    pendingBrick: null,
    pendingMipChain: null,
    revision: 0,
    requestedFrame: frame,
    builtFrame: -1,
    lastTouchedFrame: frame,
    coolingSinceMs: 0,
  };
  const index = state.residents.length;
  state.residents.push(entry);
  state.residentIndexByKey.set(chunkKeyToString(key), index);
  return entry;
}

function jobKey(job: StreamJob): string {
  if (job.kind === "chunk") {
    const k = job.key as ChunkKey;
    return `chunk:${k.x},${k.z}`;
  }
  const k = job.key as SummaryTileKey;
  return `far:${k.ring}:${k.x},${k.z}`;
}

function queueJob(state: NaadfWorldState, job: StreamJob): void {
  const key = jobKey(job);
  const existing = state.pendingJobs.get(key);
  if (!existing || job.priority < existing.priority) {
    state.pendingJobs.set(key, job);
  }
}

function touchFarTile(state: NaadfWorldState, tileKey: string): void {
  state.farTileLastTouched.set(tileKey, state.frame);
}

function promoteStaleResidents(state: NaadfWorldState): boolean {
  let promoted = false;
  for (const entry of state.residents) {
    if (entry.state !== "stale" || !entry.pendingBrick) continue;
    entry.brick = entry.pendingBrick;
    entry.mipChain = entry.pendingMipChain;
    entry.pendingBrick = null;
    entry.pendingMipChain = null;
    entry.revision = entry.brick.revision;
    entry.state = "ready";
    promoted = true;
  }
  return promoted;
}

export function updateSummaryStreaming(params: {
  state: NaadfWorldState;
  cameraX: number;
  cameraZ: number;
  velocityX: number;
  velocityZ: number;
  deltaSeconds: number;
  nowMs?: number;
}): SummaryStreamingUpdate {
  const { state, cameraX, cameraZ, velocityX, velocityZ } = params;
  const nowMs = params.nowMs ?? performance.now();
  state.frame++;
  state.cameraX = cameraX;
  state.cameraZ = cameraZ;
  state.velocityX = velocityX;
  state.velocityZ = velocityZ;

  if (promoteStaleResidents(state)) {
    syncResidentLookupTables(state.nearTable, state.hashFallback, state.residents, state.metrics);
  }

  const preload = state.config.streaming.preloadSeconds;
  const speed = Math.hypot(velocityX, velocityZ);
  const predScale = speed > 1e-6 ? preload : 0;
  const normX = speed > 1e-6 ? velocityX / speed : 0;
  const normZ = speed > 1e-6 ? velocityZ / speed : 0;
  state.predictedX = cameraX + normX * speed * predScale;
  state.predictedZ = cameraZ + normZ * speed * predScale;

  const chunkSize = state.config.world.chunkSizeCells;
  const centerKey = worldToChunkKey(cameraX, cameraZ, chunkSize);
  const predictedKey = worldToChunkKey(state.predictedX, state.predictedZ, chunkSize);

  if (!chunkKeyEquals(state.nearTable.centerChunk, centerKey)) {
    const residentIndices = state.residents
      .map((r, index) => ({ key: r.key, index }))
      .filter((r) => isChunkQueryable(state.residents[r.index]!));
    recenterNearPageTable(state.nearTable, centerKey, residentIndices);
    syncResidentLookupTables(state.nearTable, state.hashFallback, state.residents, state.metrics);
  }

  state.pendingJobs.clear();
  const radius = state.config.nearPageTable.radiusChunksXz;
  for (const key of enumerateNearTableChunks(centerKey, radius)) {
    ensureResident(state, key, state.frame);
    queueJob(state, { kind: "chunk", priority: 0, key });
  }
  for (const key of enumerateNearTableChunks(predictedKey, radius)) {
    ensureResident(state, key, state.frame);
    queueJob(state, { kind: "chunk", priority: 1, key });
  }

  if (state.config.farClipmap.enabled) {
    for (let ri = 0; ri < state.config.farClipmap.rings.length; ri++) {
      const ring = state.config.farClipmap.rings[ri]!;
      const tileCells = state.config.farClipmap.tileCells;
      const tileKey = worldToSummaryTileKey(state.predictedX, state.predictedZ, ri, ring.cellM, tileCells);
      const priority = distToCamera(state.predictedX, state.predictedZ, cameraX, cameraZ) < ring.endM ? 3 : 4;
      queueJob(state, { kind: "far_tile", priority, key: tileKey, ringIndex: ri });
      touchFarTile(state, farTileKeyString(tileKey));
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const neighbor: SummaryTileKey = { ring: ri, x: tileKey.x + dx, z: tileKey.z + dz };
          queueJob(state, { kind: "far_tile", priority: priority + 1, key: neighbor, ringIndex: ri });
          touchFarTile(state, farTileKeyString(neighbor));
        }
      }
    }
  }

  const sortedJobs = [...state.pendingJobs.values()].sort((a, b) => a.priority - b.priority);
  let jobsDone = 0;
  let commitsDone = 0;
  const maxJobs = state.forceMissingStress ? 0 : state.config.streaming.maxJobsPerFrame;
  const maxCommits = state.forceMissingStress ? 0 : state.config.streaming.maxCommitsPerFrame;

  for (const job of sortedJobs) {
    if (jobsDone >= maxJobs) break;
    if (job.kind === "chunk") {
      const key = job.key as ChunkKey;
      const entry = ensureResident(state, key, state.frame);
      if (entry.state === "building") continue;
      if (entry.state === "ready" && entry.brick !== null) continue;
      if (entry.state === "stale") continue;
      entry.state = "building";
      jobsDone++;
    } else {
      const key = job.key as SummaryTileKey;
      const tileKey = farTileKeyString(key);
      const existing = state.farTiles.get(tileKey);
      if (existing && (existing.state === "ready" || existing.state === "building")) continue;
      jobsDone++;
    }
  }

  for (const entry of state.residents) {
    if (entry.state !== "building" || commitsDone >= maxCommits) continue;
    if (state.forceMissingStress) continue;

    const replacing = entry.brick !== null;
    const newBrick = buildChunkBrick(entry.key, state.config.chunkBricks.brickSize, state.source, state.revision++);
    const newMipChain = state.config.chunkBricks.buildMips
      ? buildMipChain(newBrick, state.config.world.voxelSizeM)
      : null;

    if (state.config.streaming.keepStaleUntilReplacement && replacing) {
      entry.pendingBrick = newBrick;
      entry.pendingMipChain = newMipChain;
      entry.state = "stale";
      entry.builtFrame = state.frame;
      commitsDone++;
      continue;
    }

    entry.brick = newBrick;
    entry.mipChain = newMipChain;
    entry.pendingBrick = null;
    entry.pendingMipChain = null;
    entry.revision = newBrick.revision;
    entry.state = "ready";
    entry.builtFrame = state.frame;
    commitsDone++;
  }

  if (commitsDone > 0) {
    syncResidentLookupTables(state.nearTable, state.hashFallback, state.residents, state.metrics);
  }

  for (const job of sortedJobs) {
    if (commitsDone >= maxCommits) break;
    if (job.kind !== "far_tile" || job.ringIndex === undefined) continue;
    const key = job.key as SummaryTileKey;
    const tileKey = farTileKeyString(key);
    if (state.farTiles.has(tileKey)) continue;
    if (state.forceMissingStress) continue;

    const tile = buildFarSummaryTile(key, job.ringIndex, state.config, state.source, state.revision++);
    state.farTiles.set(tileKey, tile);
    touchFarTile(state, tileKey);
    commitsDone++;
  }

  const graceMs = state.config.streaming.evictionGraceSeconds * 1000;
  let evicted = 0;
  for (let i = state.residents.length - 1; i >= 0; i--) {
    const entry = state.residents[i]!;
    const inNear = chunkKeyInNearRadius(state.nearTable, entry.key);
    if (inNear) {
      entry.coolingSinceMs = 0;
      continue;
    }
    if (entry.coolingSinceMs === 0) entry.coolingSinceMs = nowMs;
    const ageMs = nowMs - entry.coolingSinceMs;
    if (ageMs < graceMs) continue;
    if (entry.state === "ready" || entry.state === "stale") {
      state.residentIndexByKey.delete(chunkKeyToString(entry.key));
      state.residents.splice(i, 1);
      evicted++;
    }
  }
  if (evicted > 0) {
    for (let j = 0; j < state.residents.length; j++) {
      state.residentIndexByKey.set(chunkKeyToString(state.residents[j]!.key), j);
    }
    syncResidentLookupTables(state.nearTable, state.hashFallback, state.residents, state.metrics);
  }

  const graceFrames = params.deltaSeconds > 1e-6
    ? Math.max(1, Math.ceil(state.config.streaming.evictionGraceSeconds / params.deltaSeconds))
    : Math.max(1, Math.ceil(state.config.streaming.evictionGraceSeconds * 60));
  for (const [tileKey, lastFrame] of [...state.farTileLastTouched.entries()]) {
    if (state.frame - lastFrame < graceFrames) continue;
    if (!state.farTiles.has(tileKey)) {
      state.farTileLastTouched.delete(tileKey);
      continue;
    }
    state.farTiles.delete(tileKey);
    state.farTileLastTouched.delete(tileKey);
    evicted++;
  }

  const buildingJobs = state.residents.filter((r) => r.state === "building").length;
  state.metrics.residentChunks = state.residents.filter((r) => r.state === "ready" || r.state === "stale").length;
  state.metrics.residentFarTiles = [...state.farTiles.values()].filter((t) => t.state === "ready" || t.state === "stale").length;
  state.metrics.queuedJobs = state.pendingJobs.size;
  state.metrics.buildingJobs = buildingJobs;
  state.metrics.committedJobs = commitsDone;
  state.metrics.evictedEntries = evicted;

  return {
    requestedJobs: state.pendingJobs.size,
    buildingJobs,
    committedJobs: commitsDone,
    evictedEntries: evicted,
    residentChunks: state.metrics.residentChunks,
    residentFarTiles: state.metrics.residentFarTiles,
  };
}

function chunkKeyInNearRadius(table: NearPageTable, key: ChunkKey): boolean {
  const dx = key.x - table.centerChunk.x;
  const dz = key.z - table.centerChunk.z;
  return Math.abs(dx) <= table.radiusChunksXz && Math.abs(dz) <= table.radiusChunksXz;
}

function distToCamera(x: number, z: number, cx: number, cz: number): number {
  return Math.hypot(x - cx, z - cz);
}

export function getResidentChunk(state: NaadfWorldState, key: ChunkKey): ResidentChunkEntry | null {
  return findResident(state, key);
}
