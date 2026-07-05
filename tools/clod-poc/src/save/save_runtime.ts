import { SAVE_AUTOSAVE_INTERVAL_S, SAVE_MAX_REGION_WRITES_PER_FRAME } from "./save_config.js";
import type { LoadedSavedWorld } from "./save_service.js";
import { finalizeSaveManifestAndMetadata, flushDirtyRegionBatch } from "./save_service.js";
import { openSaveDb } from "./save_db.js";
import type { SaveWorldManifest, WorldMetadataRecord } from "./save_schema.js";
import type { SavedBounds2D } from "./world_metadata/metadata_schema.js";
import { regionKeysForBounds } from "./world_metadata/metadata_store.js";
import { partitionSavedPropsByRegion } from "./prop_partition.js";
import { savedPropStore } from "./prop_store.js";

export interface SaveRuntimeCounters {
  save_dirty_region_count: number;
  save_dirty_revision: number;
  save_last_flush_written_regions: number;
  save_last_flush_pending_regions: number;
  save_last_flush_ms: number;
  save_last_error: number;
}

interface SaveRuntimeState {
  saveId: string;
  manifest: SaveWorldManifest;
  metadata: WorldMetadataRecord;
  dirtyRegionKeys: Set<string>;
  revision: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
  flushing: boolean;
  counters: Partial<SaveRuntimeCounters>;
}

let state: SaveRuntimeState | null = null;

function nowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function publishCounters(): void {
  if (!state) return;
  state.counters.save_dirty_region_count = state.dirtyRegionKeys.size;
  state.counters.save_dirty_revision = state.revision;
}

function scheduleFlush(): void {
  if (!state || state.flushTimer !== null) return;
  state.flushTimer = setTimeout(() => {
    if (!state) return;
    state.flushTimer = null;
    void flushSaveRuntimeOnce();
  }, SAVE_AUTOSAVE_INTERVAL_S * 1000);
}

export function initSaveRuntime(loadedWorld: LoadedSavedWorld, counters: Partial<SaveRuntimeCounters> = {}): void {
  state?.flushTimer && clearTimeout(state.flushTimer);
  state = {
    saveId: loadedWorld.saveId,
    manifest: { ...loadedWorld.manifest, regionKeys: [...loadedWorld.manifest.regionKeys] },
    metadata: structuredClone(loadedWorld.metadata) as WorldMetadataRecord,
    dirtyRegionKeys: new Set<string>(),
    revision: loadedWorld.manifest.regionKeys.length,
    flushTimer: null,
    flushing: false,
    counters,
  };
  savedPropStore.restore(loadedWorld.regions.flatMap((region) => region.props));
  publishCounters();
}

export function clearSaveRuntime(): void {
  if (state?.flushTimer) clearTimeout(state.flushTimer);
  state = null;
  savedPropStore.clear();
}

export function hasActiveSaveRuntime(): boolean {
  return state !== null;
}

export function markSaveRegionsDirtyForBounds(bounds: SavedBounds2D): string[] {
  if (!state) return [];
  const keys = regionKeysForBounds(bounds);
  for (const key of keys) state.dirtyRegionKeys.add(key);
  state.revision++;
  publishCounters();
  scheduleFlush();
  return keys;
}

export async function flushSaveRuntimeOnce(maxRegionWrites = SAVE_MAX_REGION_WRITES_PER_FRAME): Promise<void> {
  if (!state || state.flushing || state.dirtyRegionKeys.size === 0) return;
  const activeState = state;
  activeState.flushing = true;
  const startedAt = nowMs();
  const db = await openSaveDb();
  try {
    const propsByRegion = partitionSavedPropsByRegion(savedPropStore.snapshot());
    const dirtyRegionKeys = [...activeState.dirtyRegionKeys].sort();
    const result = await flushDirtyRegionBatch({
      db,
      saveId: activeState.saveId,
      manifest: activeState.manifest,
      metadata: activeState.metadata,
      dirtyRegionKeys,
      propsByRegion,
      maxRegionWrites,
    });
    for (const key of result.written) activeState.dirtyRegionKeys.delete(key);
    if (activeState.dirtyRegionKeys.size === 0) {
      activeState.manifest = await finalizeSaveManifestAndMetadata(
        db,
        activeState.manifest,
        activeState.metadata,
        [...activeState.manifest.regionKeys, ...result.written],
      );
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
