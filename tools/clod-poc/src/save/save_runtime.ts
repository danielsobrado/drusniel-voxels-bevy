import { projectPropEditStore } from "../project/prop_edit_store.js";
import { getVoxelEditSnapshotForBounds, voxelEditCount } from "../terrain/terrain.js";
import { SAVE_AUTOSAVE_INTERVAL_S, SAVE_MAX_REGION_WRITES_PER_FRAME } from "./save_config.js";
import type { LoadedSavedWorld } from "./save_service.js";
import { finalizeSaveManifestAndMetadata, flushDirtyRegionBatch } from "./save_service.js";
import { openSaveDb } from "./save_db.js";
import type { SavedPropInstance, SaveWorldManifest, WorldMetadataRecord } from "./save_schema.js";
import { assertWorldMetadataRecord } from "./save_schema.js";
import { attachSaveFarInvalidationCounters, markSaveInvalidationBounds, seedSaveFarInvalidationCounters, type SaveFarInvalidationCounters } from "./save_far_summary_bridge.js";
import type { SavedBounds2D } from "./world_metadata/metadata_schema.js";
import { boundsForRegion, regionKeysForBounds } from "./world_metadata/metadata_store.js";
import { partitionSavedPropsByRegion } from "./prop_partition.js";
import { savedPropStore } from "./prop_store.js";

export interface SaveRuntimeCounters extends SaveFarInvalidationCounters {
  save_loaded: number;
  save_id_hash: number;
  save_dirty_region_count: number;
  save_dirty_revision: number;
  save_last_flush_written_regions: number;
  save_last_flush_pending_regions: number;
  save_last_flush_ms: number;
  save_last_error: number;
  save_metadata_revision: number;
  save_prop_count: number;
  save_voxel_delta_count: number;
}

interface SaveRuntimeState {
  saveId: string;
  manifest: SaveWorldManifest;
  metadata: WorldMetadataRecord;
  dirtyRegionKeys: Set<string>;
  completedRegionKeys: Set<string>;
  revision: number;
  voxelDeltaCount: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
  flushing: boolean;
  counters: Partial<SaveRuntimeCounters>;
}

let state: SaveRuntimeState | null = null;
let attachedCounters: Partial<SaveRuntimeCounters> | null = null;

function nowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function saveIdHash(saveId: string): number {
  let hash = 0;
  for (let i = 0; i < saveId.length; i++) hash = ((hash * 31) + saveId.charCodeAt(i)) >>> 0;
  return hash;
}

export function seedSaveRuntimeCounters(counters: Partial<SaveRuntimeCounters>): void {
  counters.save_loaded = counters.save_loaded ?? 0;
  counters.save_id_hash = counters.save_id_hash ?? 0;
  counters.save_dirty_region_count = counters.save_dirty_region_count ?? 0;
  counters.save_dirty_revision = counters.save_dirty_revision ?? 0;
  counters.save_last_flush_written_regions = counters.save_last_flush_written_regions ?? 0;
  counters.save_last_flush_pending_regions = counters.save_last_flush_pending_regions ?? 0;
  counters.save_last_flush_ms = counters.save_last_flush_ms ?? 0;
  counters.save_last_error = counters.save_last_error ?? 0;
  counters.save_metadata_revision = counters.save_metadata_revision ?? 0;
  counters.save_prop_count = counters.save_prop_count ?? 0;
  counters.save_voxel_delta_count = counters.save_voxel_delta_count ?? 0;
  seedSaveFarInvalidationCounters(counters);
}

function publishCounters(): void {
  if (!state) {
    if (attachedCounters) attachedCounters.save_loaded = 0;
    return;
  }
  seedSaveRuntimeCounters(state.counters);
  state.counters.save_loaded = 1;
  state.counters.save_id_hash = saveIdHash(state.saveId);
  state.counters.save_dirty_region_count = state.dirtyRegionKeys.size;
  state.counters.save_dirty_revision = state.revision;
  state.counters.save_metadata_revision = state.metadata.revision;
  state.counters.save_prop_count = savedPropStore.snapshot().length;
  state.counters.save_voxel_delta_count = state.voxelDeltaCount;
}

function pointBoundsForProp(prop: SavedPropInstance): SavedBounds2D {
  return {
    minX: prop.position[0],
    minZ: prop.position[2],
    maxX: prop.position[0],
    maxZ: prop.position[2],
  };
}

function scheduleFlush(): void {
  if (!state || state.flushTimer !== null) return;
  state.flushTimer = setTimeout(() => {
    if (!state) return;
    state.flushTimer = null;
    void flushSaveRuntimeOnce();
  }, SAVE_AUTOSAVE_INTERVAL_S * 1000);
}

export function attachSaveRuntimeCounters(counters: Partial<SaveRuntimeCounters> | null): void {
  attachedCounters = counters;
  attachSaveFarInvalidationCounters(counters);
  if (!counters) {
    if (state) state.counters = {};
    return;
  }
  seedSaveRuntimeCounters(counters);
  if (!state) {
    counters.save_loaded = 0;
    return;
  }
  state.counters = counters;
  publishCounters();
}

export function initSaveRuntime(loadedWorld: LoadedSavedWorld, counters: Partial<SaveRuntimeCounters> = {}): void {
  state?.flushTimer && clearTimeout(state.flushTimer);
  const activeCounters = attachedCounters ?? counters;
  state = {
    saveId: loadedWorld.saveId,
    manifest: { ...loadedWorld.manifest, regionKeys: [...loadedWorld.manifest.regionKeys] },
    metadata: structuredClone(loadedWorld.metadata) as WorldMetadataRecord,
    dirtyRegionKeys: new Set<string>(),
    completedRegionKeys: new Set<string>(),
    revision: loadedWorld.manifest.regionKeys.length,
    voxelDeltaCount: loadedWorld.voxelDeltaCount,
    flushTimer: null,
    flushing: false,
    counters: activeCounters,
  };
  savedPropStore.restore(loadedWorld.regions.flatMap((region) => region.props));
  projectPropEditStore.restore(savedPropStore.activeProjectProps());
  publishCounters();
}

export function clearSaveRuntime(): void {
  if (state?.flushTimer) clearTimeout(state.flushTimer);
  state = null;
  savedPropStore.clear();
  projectPropEditStore.clear();
  publishCounters();
}

export function hasActiveSaveRuntime(): boolean {
  return state !== null;
}

export function hasLoadedSavePropAuthority(): boolean {
  return state !== null && savedPropStore.hasProps();
}

export function markSaveRegionsDirtyForBounds(bounds: SavedBounds2D): string[] {
  if (!state) return [];
  const keys = regionKeysForBounds(bounds);
  for (const key of keys) state.dirtyRegionKeys.add(key);
  markSaveInvalidationBounds(bounds);
  state.revision++;
  publishCounters();
  scheduleFlush();
  return keys;
}

function markSaveRegionsDirtyForBoundList(boundsList: readonly SavedBounds2D[]): string[] {
  if (!state) return [];
  const keys = new Set<string>();
  for (const bounds of boundsList) {
    for (const key of regionKeysForBounds(bounds)) {
      keys.add(key);
      state.dirtyRegionKeys.add(key);
    }
    markSaveInvalidationBounds(bounds);
  }
  state.revision++;
  publishCounters();
  scheduleFlush();
  return [...keys].sort();
}

export function markSaveRuntimeLoadedRegionsInvalidated(): number {
  if (!state) return 0;
  for (const regionKey of [...state.manifest.regionKeys].sort()) markSaveInvalidationBounds(boundsForRegion(regionKey));
  return state.manifest.regionKeys.length;
}

export function updateSaveRuntimeMetadata(metadata: WorldMetadataRecord, dirtyBounds: SavedBounds2D): string[] {
  if (!state) return [];
  assertWorldMetadataRecord(metadata);
  state.metadata = structuredClone(metadata) as WorldMetadataRecord;
  return markSaveRegionsDirtyForBounds(dirtyBounds);
}

export function upsertSaveRuntimeProp(prop: SavedPropInstance): string[] {
  if (!state) return [];
  const previous = savedPropStore.upsert(prop);
  projectPropEditStore.restore(savedPropStore.activeProjectProps());
  const boundsList = previous ? [pointBoundsForProp(previous), pointBoundsForProp(prop)] : [pointBoundsForProp(prop)];
  return markSaveRegionsDirtyForBoundList(boundsList);
}

export function removeSaveRuntimeProp(id: string, dirtyBounds: SavedBounds2D): string[] {
  if (!state) return [];
  const previous = savedPropStore.remove(id);
  projectPropEditStore.restore(savedPropStore.activeProjectProps());
  return markSaveRegionsDirtyForBoundList(previous ? [pointBoundsForProp(previous), dirtyBounds] : [dirtyBounds]);
}

export async function flushSaveRuntimeOnce(maxRegionWrites = SAVE_MAX_REGION_WRITES_PER_FRAME): Promise<void> {
  if (!state || state.flushing || state.dirtyRegionKeys.size === 0) return;
  const activeState = state;
  activeState.flushing = true;
  const startedAt = nowMs();
  const db = await openSaveDb();
  try {
    activeState.voxelDeltaCount = voxelEditCount();
    const propsByRegion = partitionSavedPropsByRegion(savedPropStore.snapshot());
    const dirtyRegionKeys = [...activeState.dirtyRegionKeys].sort();
    const result = await flushDirtyRegionBatch({
      db,
      saveId: activeState.saveId,
      manifest: activeState.manifest,
      metadata: activeState.metadata,
      dirtyRegionKeys,
      propsByRegion,
      snapshotForRegion: (regionKey) => {
        const bounds = boundsForRegion(regionKey);
        return getVoxelEditSnapshotForBounds(bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ);
      },
      maxRegionWrites,
    });
    for (const key of result.written) {
      activeState.dirtyRegionKeys.delete(key);
      activeState.completedRegionKeys.add(key);
    }
    if (activeState.dirtyRegionKeys.size === 0) {
      activeState.manifest = await finalizeSaveManifestAndMetadata(
        db,
        activeState.manifest,
        activeState.metadata,
        [...activeState.manifest.regionKeys, ...activeState.completedRegionKeys],
      );
      activeState.completedRegionKeys.clear();
    }
    activeState.counters.save_last_flush_written_regions = result.written.length;
    activeState.counters.save_last_flush_pending_regions = activeState.dirtyRegionKeys.size;
    activeState.counters.save_last_flush_ms = nowMs() - startedAt;
    activeState.counters.save_last_error = 0;
  } catch (error) {
    activeState.counters.save_last_error = 1;
    console.error("[save-runtime] autosave flush failed", error);
  } finally {
    db.close();
    activeState.flushing = false;
    publishCounters();
    if (activeState.dirtyRegionKeys.size > 0) scheduleFlush();
  }
}
