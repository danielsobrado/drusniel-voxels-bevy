import { getVoxelEditSnapshot, replaceVoxelEdits } from "../terrain/terrain.js";
import type { VoxelChunkKey, VoxelEditSnapshot } from "../terrain/voxel_edits/voxel_edit_types.js";
import { mergePartitionedVoxelSnapshots, partitionVoxelSnapshot } from "./voxel_partition.js";
import { regionKeyForWorld } from "./region_key.js";
import { SAVE_CHUNK_SIZE_M } from "./save_config.js";
import type { SaveRegionRecords } from "./region_store.js";
import type { SaveWorldManifest, WorldMetadataRecord } from "./save_schema.js";
import { openSaveDb, readRegionRecords, readSaveManifest, readWorldMetadata, writeRegionRecords, writeSaveManifestAndMetadata } from "./save_db.js";

export interface LoadedSavedWorld {
  saveId: string;
  manifest: SaveWorldManifest;
  metadata: WorldMetadataRecord;
  regions: SaveRegionRecords[];
  voxelSnapshot: VoxelEditSnapshot;
  voxelDeltaCount: number;
  propInstanceCount: number;
  loadMs: number;
}

export interface LoadSavedWorldOptions {
  expectedSeed?: number;
  replaceVoxelSnapshot?: (snapshot: VoxelEditSnapshot) => void;
  nowMs?: () => number;
}

export interface SaveDirtyRegionsInput {
  db: IDBDatabase;
  saveId: string;
  manifest: SaveWorldManifest;
  metadata: WorldMetadataRecord;
  dirtyRegionKeys: readonly string[];
  propsByRegion?: ReadonlyMap<string, SaveRegionRecords["props"]>;
  snapshot?: VoxelEditSnapshot;
}

function defaultNowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function validateExpectedSeed(manifest: SaveWorldManifest, expectedSeed: number | undefined): void {
  if (expectedSeed !== undefined && manifest.seed !== expectedSeed) {
    throw new Error(`saved seed ${manifest.seed} does not match resolved world seed ${expectedSeed}`);
  }
}

export function saveIdFromQuery(searchParams: URLSearchParams): string | null {
  const saveId = searchParams.get("save");
  return saveId && saveId.trim().length > 0 ? saveId.trim() : null;
}

export function resolvedSeedFromQuery(searchParams: URLSearchParams): number {
  const raw = searchParams.get("seed");
  const parsed = raw === null ? 0 : Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function loadSavedWorldFromDb(
  db: IDBDatabase,
  saveId: string,
  options: LoadSavedWorldOptions = {},
): Promise<LoadedSavedWorld> {
  const startedAt = (options.nowMs ?? defaultNowMs)();
  const manifest = await readSaveManifest(db, saveId);
  if (!manifest) throw new Error(`save manifest not found: ${saveId}`);
  validateExpectedSeed(manifest, options.expectedSeed);

  const regions: SaveRegionRecords[] = [];
  for (const regionKey of [...manifest.regionKeys].sort()) {
    const records = await readRegionRecords(db, saveId, regionKey);
    if (!records) throw new Error(`save region not found: ${regionKey}`);
    regions.push(records);
  }

  const metadata = await readWorldMetadata(db, saveId);
  if (!metadata) throw new Error(`save metadata not found: ${saveId}`);

  const voxelSnapshot = mergePartitionedVoxelSnapshots(regions.map((region) => region.voxelDeltas));
  (options.replaceVoxelSnapshot ?? replaceVoxelEdits)(voxelSnapshot);

  const finishedAt = (options.nowMs ?? defaultNowMs)();
  return {
    saveId,
    manifest,
    metadata,
    regions,
    voxelSnapshot,
    voxelDeltaCount: voxelSnapshot.deltas.length,
    propInstanceCount: regions.reduce((total, region) => total + region.props.length, 0),
    loadMs: Math.max(0, finishedAt - startedAt),
  };
}

export async function loadSavedWorldFromQuery(
  searchParams: URLSearchParams,
  options: LoadSavedWorldOptions = {},
): Promise<LoadedSavedWorld | null> {
  const saveId = saveIdFromQuery(searchParams);
  if (!saveId) return null;
  const db = await openSaveDb();
  try {
    return await loadSavedWorldFromDb(db, saveId, {
      expectedSeed: options.expectedSeed ?? resolvedSeedFromQuery(searchParams),
      replaceVoxelSnapshot: options.replaceVoxelSnapshot,
      nowMs: options.nowMs,
    });
  } finally {
    db.close();
  }
}

export function markRegionDirtyFromDirtyChunks(dirtyChunks: readonly VoxelChunkKey[]): string[] {
  const regionKeys = new Set<string>();
  for (const chunk of dirtyChunks) regionKeys.add(regionKeyForWorld(chunk.x * SAVE_CHUNK_SIZE_M, chunk.z * SAVE_CHUNK_SIZE_M));
  return [...regionKeys].sort();
}

export async function saveDirtyRegions(input: SaveDirtyRegionsInput): Promise<string[]> {
  const snapshot = input.snapshot ?? getVoxelEditSnapshot();
  const partsByRegion = new Map(partitionVoxelSnapshot(snapshot).map((part) => [part.regionKey, part]));
  const written: string[] = [];

  for (const regionKey of input.dirtyRegionKeys) {
    const voxelDeltas = partsByRegion.get(regionKey) ?? { schemaVersion: 1 as const, regionKey, format: "json" as const, deltas: [] };
    const props = input.propsByRegion?.get(regionKey) ?? [];
    const existing = await readRegionRecords(input.db, input.saveId, regionKey);
    const revision = (existing?.manifest.revision ?? 0) + 1;
    const [rx, rz] = regionKey.slice(2).split("_").map(Number);
    if (!Number.isSafeInteger(rx) || !Number.isSafeInteger(rz)) throw new Error(`invalid dirty region key: ${regionKey}`);
    await writeRegionRecords(input.db, input.saveId, {
      manifest: {
        schemaVersion: 1,
        regionKey,
        rx,
        rz,
        revision,
        authorityRevision: voxelDeltas.deltas.reduce((max, delta) => Math.max(max, delta.revision), 0),
        voxelDeltaCount: voxelDeltas.deltas.length,
        propCount: props.length,
        updatedAt: new Date().toISOString(),
      },
      voxelDeltas,
      props: [...props],
    });
    written.push(regionKey);
  }

  const regionKeys = [...new Set([...input.manifest.regionKeys, ...written])].sort();
  await writeSaveManifestAndMetadata(input.db, { ...input.manifest, regionKeys, updatedAt: new Date().toISOString() }, input.metadata);
  return written;
}
