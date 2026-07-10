import { getVoxelEditSnapshot, replaceVoxelEdits } from "../terrain/terrain.js";
import type { VoxelChunkKey, VoxelEditSnapshot } from "../terrain/voxel_edits/voxel_edit_types.js";
import { assertCriticalPathValidation, validateCriticalPaths, type CriticalPathValidationResult } from "./critical_path_validation.js";
import { mergeSavedPropsFromRegions } from "./prop_partition.js";
import { mergePartitionedVoxelSnapshots, partitionVoxelSnapshot } from "./voxel_partition.js";
import { parseRegionKey, regionKeyForWorld } from "./region_key.js";
import { SAVE_CHUNK_SIZE_M, SAVE_MAX_REGION_WRITES_PER_FRAME } from "./save_config.js";
import type { SaveRegionRecords } from "./region_store.js";
import type { SaveWorldManifest, WorldMetadataRecord } from "./save_schema.js";
import { assertWorldMetadataPropLinks, regionVoxelDeltasToDeltas } from "./save_schema.js";
import { openSaveDb, readRegionRecords, readSaveManifest, readWorldMetadata, writeRegionRecords, writeSaveManifestAndMetadata } from "./save_db.js";
import { markSaveInvalidationBounds } from "./save_far_summary_bridge.js";
import { boundsForRegion } from "./world_metadata/metadata_store.js";

export interface LoadedSavedWorld {
  saveId: string;
  manifest: SaveWorldManifest;
  metadata: WorldMetadataRecord;
  regions: SaveRegionRecords[];
  voxelSnapshot: VoxelEditSnapshot;
  voxelDeltaCount: number;
  propInstanceCount: number;
  criticalPathValidation: CriticalPathValidationResult;
  loadMs: number;
}

export interface LoadSavedWorldOptions {
  expectedSeed?: number;
  replaceVoxelSnapshot?: (snapshot: VoxelEditSnapshot) => void;
  nowMs?: () => number;
  blockCriticalPathWarnings?: boolean;
  publishLoadedRegionInvalidations?: boolean;
}

export interface SaveDirtyRegionsInput {
  db: IDBDatabase;
  saveId: string;
  manifest: SaveWorldManifest;
  metadata: WorldMetadataRecord;
  dirtyRegionKeys: readonly string[];
  propsByRegion?: ReadonlyMap<string, SaveRegionRecords["props"]>;
  snapshot?: VoxelEditSnapshot;
  snapshotForRegion?: (regionKey: string) => VoxelEditSnapshot;
  maxRegionWrites?: number;
}

export interface DirtyRegionBatchResult {
  written: string[];
  pending: string[];
}

export interface SaveDirtyRegionsResult extends DirtyRegionBatchResult {
  finalized: boolean;
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

export function seedOverrideFromQuery(searchParams: URLSearchParams): number | undefined {
  const raw = searchParams.get("seed");
  if (raw === null) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function resolvedSeedFromQuery(searchParams: URLSearchParams): number {
  return seedOverrideFromQuery(searchParams) ?? 0;
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
  const savedProps = mergeSavedPropsFromRegions(regions.map((region) => region.props));
  const propIds = new Set(savedProps.map((prop) => prop.id));
  assertWorldMetadataPropLinks(metadata, propIds);
  const criticalPathValidation = validateCriticalPaths(metadata, { propIds, nowMs: options.nowMs });
  assertCriticalPathValidation(criticalPathValidation, { blockWarnings: options.blockCriticalPathWarnings });

  const voxelSnapshot = mergePartitionedVoxelSnapshots(regions.map((region) => region.voxelDeltas));
  (options.replaceVoxelSnapshot ?? replaceVoxelEdits)(voxelSnapshot);
  if (options.publishLoadedRegionInvalidations) {
    for (const regionKey of [...manifest.regionKeys].sort()) markSaveInvalidationBounds(boundsForRegion(regionKey));
  }

  const finishedAt = (options.nowMs ?? defaultNowMs)();
  return {
    saveId,
    manifest,
    metadata,
    regions,
    voxelSnapshot,
    voxelDeltaCount: voxelSnapshot.deltas.length,
    propInstanceCount: regions.reduce((total, region) => total + region.props.length, 0),
    criticalPathValidation,
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
      expectedSeed: options.expectedSeed ?? seedOverrideFromQuery(searchParams),
      replaceVoxelSnapshot: options.replaceVoxelSnapshot,
      nowMs: options.nowMs,
      blockCriticalPathWarnings: options.blockCriticalPathWarnings,
      publishLoadedRegionInvalidations: options.publishLoadedRegionInvalidations,
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

export function selectDirtyRegionWriteBatch(
  dirtyRegionKeys: readonly string[],
  maxRegionWrites = SAVE_MAX_REGION_WRITES_PER_FRAME,
): string[] {
  const maxWrites = Math.max(0, Math.floor(maxRegionWrites));
  return [...dirtyRegionKeys].sort().slice(0, maxWrites);
}

export async function flushDirtyRegionBatch(input: SaveDirtyRegionsInput): Promise<DirtyRegionBatchResult> {
  const batch = selectDirtyRegionWriteBatch(input.dirtyRegionKeys, input.maxRegionWrites ?? SAVE_MAX_REGION_WRITES_PER_FRAME);
  const partsByRegion = input.snapshotForRegion
    ? null
    : new Map(partitionVoxelSnapshot(input.snapshot ?? getVoxelEditSnapshot()).map((part) => [part.regionKey, part]));
  const written: string[] = [];

  for (const regionKey of batch) {
    const voxelDeltas = input.snapshotForRegion
      ? { schemaVersion: 1 as const, regionKey, format: "json" as const, deltas: [...input.snapshotForRegion(regionKey).deltas] }
      : partsByRegion?.get(regionKey) ?? { schemaVersion: 1 as const, regionKey, format: "json" as const, deltas: [] };
    const deltas = regionVoxelDeltasToDeltas(voxelDeltas);
    const props = input.propsByRegion?.get(regionKey) ?? [];
    const existing = await readRegionRecords(input.db, input.saveId, regionKey);
    const revision = (existing?.manifest.revision ?? 0) + 1;
    const { rx, rz } = parseRegionKey(regionKey);
    await writeRegionRecords(input.db, input.saveId, {
      manifest: {
        schemaVersion: 1,
        regionKey,
        rx,
        rz,
        revision,
        authorityRevision: deltas.reduce((max, delta) => Math.max(max, delta.revision), 0),
        voxelDeltaCount: deltas.length,
        propCount: props.length,
        updatedAt: new Date().toISOString(),
      },
      voxelDeltas,
      props: [...props],
    });
    written.push(regionKey);
    markSaveInvalidationBounds(boundsForRegion(regionKey));
  }

  const writtenSet = new Set(written);
  return {
    written,
    pending: input.dirtyRegionKeys.filter((regionKey) => !writtenSet.has(regionKey)).sort(),
  };
}

export async function finalizeSaveManifestAndMetadata(
  db: IDBDatabase,
  manifest: SaveWorldManifest,
  metadata: WorldMetadataRecord,
  regionKeys: readonly string[],
): Promise<SaveWorldManifest> {
  const nextManifest = {
    ...manifest,
    regionKeys: [...new Set(regionKeys)].sort(),
    updatedAt: new Date().toISOString(),
  };
  await writeSaveManifestAndMetadata(db, nextManifest, metadata);
  return nextManifest;
}

export async function saveDirtyRegions(input: SaveDirtyRegionsInput): Promise<SaveDirtyRegionsResult> {
  const result = await flushDirtyRegionBatch(input);
  let finalized = false;
  if (result.pending.length === 0) {
    await finalizeSaveManifestAndMetadata(
      input.db,
      input.manifest,
      input.metadata,
      [...input.manifest.regionKeys, ...result.written],
    );
    finalized = true;
  }
  return { ...result, finalized };
}
