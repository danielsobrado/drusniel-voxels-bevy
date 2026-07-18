import { PropEditStore, projectPropEditStore } from "../project/prop_edit_store.js";
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
import { SavedPropStore, savedPropStore } from "./prop_store.js";
import { SaveDirtyRegionRevisions } from "./save_dirty_region_revisions.js";
import { SparsePropExclusionBitsets } from "../world/prop_exclusion.js";
import { deriveEnvironmentalPropId, type PropCandidateAddress } from "../world/prop_identity.js";
import { regionKeyForWorld } from "./region_key.js";
import { compileFeatureStamps, type FeatureStampField } from "../world/feature_stamps.js";

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
  prop_delta_count: number;
  prop_exclusion_tiles: number;
  prop_exclusion_guard_mismatches: number;
}

interface SaveRuntimeState {
  saveId: string;
  manifest: SaveWorldManifest;
  metadata: WorldMetadataRecord;
  featureStamps: FeatureStampField;
  dirtyRegions: SaveDirtyRegionRevisions;
  completedRegionKeys: Set<string>;
  revision: number;
  voxelDeltaCount: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
  flushPromise: Promise<void> | null;
  lastFlushError: unknown | null;
  counters: Partial<SaveRuntimeCounters>;
}

let state: SaveRuntimeState | null = null;
let attachedCounters: Partial<SaveRuntimeCounters> | null = null;
let propExclusions = new SparsePropExclusionBitsets();
// Dev-only cross-check of the incremental mutation path against a full rebuild
// (rpg-content-density-scaling D0). Demote to test-only once the D3 storm is green.
const equivalenceGuard = {
  enabled: Boolean(import.meta.env?.DEV),
  everyNEdits: 16,
  editsSinceCheck: 0,
  mismatches: 0,
};
type FeatureStampListener = (bounds: SavedBounds2D, field: FeatureStampField) => void;
const featureStampListeners = new Set<FeatureStampListener>();

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
  counters.prop_delta_count = counters.prop_delta_count ?? 0;
  counters.prop_exclusion_tiles = counters.prop_exclusion_tiles ?? 0;
  counters.prop_exclusion_guard_mismatches = counters.prop_exclusion_guard_mismatches ?? 0;
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
  state.counters.save_dirty_region_count = state.dirtyRegions.size;
  state.counters.save_dirty_revision = state.revision;
  state.counters.save_metadata_revision = state.metadata.revision;
  state.counters.save_prop_count = savedPropStore.count();
  state.counters.save_voxel_delta_count = state.voxelDeltaCount;
  state.counters.prop_exclusion_guard_mismatches = equivalenceGuard.mismatches;
  Object.assign(state.counters, propExclusions.counters());
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
  const restoredProps = loadedWorld.regions.flatMap((region) => region.props);
  const validatedSavedProps = new SavedPropStore();
  validatedSavedProps.restore(restoredProps);
  const savedPropsSnapshot = validatedSavedProps.snapshot();
  const activeProjectProps = validatedSavedProps.activeProjectProps();
  const validatedProjectProps = new PropEditStore();
  validatedProjectProps.restore(activeProjectProps);
  const nextPropExclusions = SparsePropExclusionBitsets.fromSavedProps(savedPropsSnapshot);
  const activeCounters = attachedCounters ?? counters;
  const nextState: SaveRuntimeState = {
    saveId: loadedWorld.saveId,
    manifest: { ...loadedWorld.manifest, regionKeys: [...loadedWorld.manifest.regionKeys] },
    metadata: structuredClone(loadedWorld.metadata) as WorldMetadataRecord,
    featureStamps: compileFeatureStamps(loadedWorld.metadata),
    dirtyRegions: new SaveDirtyRegionRevisions(),
    completedRegionKeys: new Set<string>(),
    revision: loadedWorld.manifest.regionKeys.length,
    voxelDeltaCount: loadedWorld.voxelDeltaCount,
    flushTimer: null,
    flushPromise: null,
    lastFlushError: null,
    counters: activeCounters,
  };

  if (state?.flushTimer) clearTimeout(state.flushTimer);
  state = nextState;
  savedPropStore.restore(savedPropsSnapshot);
  propExclusions = nextPropExclusions;
  projectPropEditStore.restore(activeProjectProps);
  equivalenceGuard.editsSinceCheck = 0;
  equivalenceGuard.mismatches = 0;
  publishCounters();
}

export function clearSaveRuntime(): void {
  if (state?.flushTimer) clearTimeout(state.flushTimer);
  state = null;
  savedPropStore.clear();
  propExclusions = new SparsePropExclusionBitsets();
  projectPropEditStore.clear();
  equivalenceGuard.editsSinceCheck = 0;
  equivalenceGuard.mismatches = 0;
  publishCounters();
}

export function hasActiveSaveRuntime(): boolean {
  return state !== null;
}

export function getSaveRuntimeWorldId(): string | null {
  return state?.manifest.worldId ?? null;
}

export function isSaveRuntimeConverged(): boolean {
  return state !== null
    && state.dirtyRegions.size === 0
    && state.flushPromise === null
    && state.lastFlushError === null;
}

export function hasLoadedSavePropAuthority(): boolean {
  return state !== null && savedPropStore.hasProps();
}

export function markSaveRegionsDirtyForBounds(bounds: SavedBounds2D): string[] {
  if (!state) return [];
  const keys = regionKeysForBounds(bounds);
  markSaveInvalidationBounds(bounds);
  state.revision++;
  state.dirtyRegions.mark(keys, state.revision);
  publishCounters();
  scheduleFlush();
  return keys;
}

function markSaveRegionsDirtyForBoundList(boundsList: readonly SavedBounds2D[]): string[] {
  if (!state) return [];
  const keys = new Set<string>();
  for (const bounds of boundsList) {
    for (const key of regionKeysForBounds(bounds)) keys.add(key);
    markSaveInvalidationBounds(bounds);
  }
  state.revision++;
  state.dirtyRegions.mark(keys, state.revision);
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
  state.featureStamps = compileFeatureStamps(state.metadata);
  for (const listener of featureStampListeners) listener(dirtyBounds, state.featureStamps);
  return markSaveRegionsDirtyForBounds(dirtyBounds);
}

function syncProjectPropEditStore(previous: SavedPropInstance | null, next: SavedPropInstance | null): void {
  const id = next?.id ?? previous?.id;
  if (!id) return;
  const present = projectPropEditStore.get(id) !== undefined;
  if (next?.state !== "active") {
    if (present) projectPropEditStore.remove(id);
    return;
  }
  const input = {
    prefabId: next.prefabId,
    position: next.position,
    rotation: next.rotation,
    scale: next.scale,
    anchor: next.anchor,
    seed: next.seed,
    variationId: next.variationId,
    flags: next.flags,
  };
  if (present) projectPropEditStore.update(id, input);
  else projectPropEditStore.add({ id, ...input });
}

export function configurePropExclusionEquivalenceGuard(config: { enabled?: boolean; everyNEdits?: number }): void {
  if (config.enabled !== undefined) equivalenceGuard.enabled = config.enabled;
  if (config.everyNEdits !== undefined) equivalenceGuard.everyNEdits = Math.max(1, config.everyNEdits);
}

function runEquivalenceGuard(): void {
  if (!equivalenceGuard.enabled) return;
  if (++equivalenceGuard.editsSinceCheck < equivalenceGuard.everyNEdits) return;
  equivalenceGuard.editsSinceCheck = 0;
  const savedProps = savedPropStore.snapshot();
  const rebuiltExclusions = SparsePropExclusionBitsets.fromSavedProps(savedProps);
  if (!propExclusions.contentEquals(rebuiltExclusions)) {
    equivalenceGuard.mismatches++;
    console.error("[save-runtime] incremental prop exclusions diverged from full rebuild; adopting rebuild");
    propExclusions = rebuiltExclusions;
  }
  const activeIds = new Set(savedProps.filter((prop) => prop.state === "active").map((prop) => prop.id));
  const editStoreIds = projectPropEditStore.snapshot().map((prop) => prop.id);
  if (editStoreIds.length !== activeIds.size || editStoreIds.some((id) => !activeIds.has(id))) {
    equivalenceGuard.mismatches++;
    console.error("[save-runtime] incremental project prop edit store diverged from active saved props; restoring");
    projectPropEditStore.restore(savedPropStore.activeProjectProps());
  }
}

export function upsertSaveRuntimeProp(prop: SavedPropInstance): string[] {
  if (!state) return [];
  const previous = savedPropStore.upsert(prop);
  propExclusions.applyDelta(previous, prop);
  syncProjectPropEditStore(previous, prop);
  runEquivalenceGuard();
  const boundsList = previous ? [pointBoundsForProp(previous), pointBoundsForProp(prop)] : [pointBoundsForProp(prop)];
  return markSaveRegionsDirtyForBoundList(boundsList);
}

export function removeSaveRuntimeProp(id: string, dirtyBounds: SavedBounds2D): string[] {
  if (!state) return [];
  const previous = savedPropStore.remove(id);
  if (previous) {
    propExclusions.applyDelta(previous, null);
    syncProjectPropEditStore(previous, null);
    runEquivalenceGuard();
  }
  return markSaveRegionsDirtyForBoundList(previous ? [pointBoundsForProp(previous), dirtyBounds] : [dirtyBounds]);
}

export function getSaveRuntimePropExclusions(): SparsePropExclusionBitsets {
  return propExclusions;
}

export function getSaveRuntimeFeatureStamps(): FeatureStampField | null {
  return state?.featureStamps ?? null;
}

export function subscribeSaveRuntimeFeatureStamps(listener: FeatureStampListener): () => void {
  featureStampListeners.add(listener);
  return () => featureStampListeners.delete(listener);
}

/** Interaction write path: deterministic baseline candidate -> durable destroyed delta. */
export function destroyEnvironmentalPropCandidate(
  address: PropCandidateAddress,
  position: readonly [number, number, number],
  prefabId: string,
): string[] {
  if (!state) return [];
  const prop: SavedPropInstance = {
    id: deriveEnvironmentalPropId(state.manifest.worldId, address),
    prefabId,
    position: [position[0], position[1], position[2]],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    regionKey: regionKeyForWorld(position[0], position[2]),
    state: "destroyed",
    tags: ["environmental"],
    environmental: address,
    revision: state.revision + 1,
  };
  return upsertSaveRuntimeProp(prop);
}

async function performSaveRuntimeFlush(
  activeState: SaveRuntimeState,
  maxRegionWrites: number,
  throwOnError: boolean,
): Promise<void> {
  const startedAt = nowMs();
  let db: IDBDatabase | null = null;
  let acknowledgedRegionKeys: string[] = [];
  try {
    activeState.voxelDeltaCount = voxelEditCount();
    const propsByRegion = partitionSavedPropsByRegion(savedPropStore.snapshot());
    const dirtyRegionKeys = activeState.dirtyRegions.keys();
    const dirtySnapshot = activeState.dirtyRegions.capture(dirtyRegionKeys);
    const voxelSnapshotsByRegion = new Map<string, ReturnType<typeof getVoxelEditSnapshotForBounds>>();
    for (const regionKey of dirtyRegionKeys) {
      const bounds = boundsForRegion(regionKey);
      voxelSnapshotsByRegion.set(
        regionKey,
        getVoxelEditSnapshotForBounds(bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ),
      );
    }

    db = await openSaveDb();
    const result = await flushDirtyRegionBatch({
      db,
      saveId: activeState.saveId,
      manifest: activeState.manifest,
      metadata: activeState.metadata,
      dirtyRegionKeys,
      propsByRegion,
      snapshotForRegion: (regionKey) => {
        const snapshot = voxelSnapshotsByRegion.get(regionKey);
        if (!snapshot) throw new Error(`missing captured voxel snapshot for ${regionKey}`);
        return snapshot;
      },
      maxRegionWrites,
    });
    acknowledgedRegionKeys = activeState.dirtyRegions.acknowledge(result.written, dirtySnapshot);
    for (const key of acknowledgedRegionKeys) activeState.completedRegionKeys.add(key);
    if (activeState.dirtyRegions.size === 0) {
      activeState.manifest = await finalizeSaveManifestAndMetadata(
        db,
        activeState.manifest,
        activeState.metadata,
        [...activeState.manifest.regionKeys, ...activeState.completedRegionKeys],
      );
      activeState.completedRegionKeys.clear();
    }
    if (state === activeState) {
      activeState.counters.save_last_flush_written_regions = result.written.length;
      activeState.counters.save_last_flush_pending_regions = activeState.dirtyRegions.size;
      activeState.counters.save_last_flush_ms = nowMs() - startedAt;
      activeState.counters.save_last_error = 0;
    }
    activeState.lastFlushError = null;
  } catch (error) {
    if (acknowledgedRegionKeys.length > 0 && activeState.dirtyRegions.size === 0) {
      activeState.revision++;
      activeState.dirtyRegions.mark(acknowledgedRegionKeys, activeState.revision);
    }
    if (state === activeState) activeState.counters.save_last_error = 1;
    activeState.lastFlushError = error;
    console.error("[save-runtime] autosave flush failed", error);
    if (throwOnError) throw error;
  } finally {
    db?.close();
    publishCounters();
    if (state === activeState && activeState.dirtyRegions.size > 0) scheduleFlush();
  }
}

async function flushSaveRuntime(
  maxRegionWrites: number,
  throwOnError: boolean,
): Promise<void> {
  const activeState = state;
  if (!activeState) return;
  // Re-check after every await: several callers can queue behind the same in-flight
  // flush, and each must observe any flush a prior waiter started before proceeding.
  while (activeState.flushPromise) {
    try {
      await activeState.flushPromise;
    } catch (error) {
      if (throwOnError) throw error;
    }
  }
  if (state !== activeState || activeState.dirtyRegions.size === 0) {
    if (throwOnError && activeState.lastFlushError) throw activeState.lastFlushError;
    return;
  }
  const promise = performSaveRuntimeFlush(activeState, maxRegionWrites, throwOnError);
  activeState.flushPromise = promise;
  try {
    await promise;
  } finally {
    if (activeState.flushPromise === promise) activeState.flushPromise = null;
  }
}

export async function flushSaveRuntimeOnce(maxRegionWrites = SAVE_MAX_REGION_WRITES_PER_FRAME): Promise<void> {
  await flushSaveRuntime(maxRegionWrites, false);
}

/** Device-loss and shutdown path: waits for any active autosave and surfaces persistence errors. */
export async function flushSaveRuntimeOrThrow(maxRegionWrites = SAVE_MAX_REGION_WRITES_PER_FRAME): Promise<void> {
  await flushSaveRuntime(maxRegionWrites, true);
}
