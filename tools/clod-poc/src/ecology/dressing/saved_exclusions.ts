import { isPersistentDressingClass, type PersistentDressingClassId } from "./class_registry.js";
import { parseStableIdKey, stableIdKey } from "./stable_id.js";
import type { DressingStableId } from "./types.js";
import { regionKeyForWorld } from "../../save/region_key.js";
import { removeSaveRuntimeProp, upsertSaveRuntimeProp } from "../../save/save_runtime.js";
import type { SavedPropInstance } from "../../save/save_schema.js";
import { savedPropStore } from "../../save/prop_store.js";

const DRESSING_SAVE_ID_PREFIX = "dressing:";
const DRESSING_SAVE_TAG = "dressing";
const DEFAULT_POSITION_TOLERANCE_M = 0.85;

export interface PersistentDressingExclusionSnapshot {
  readonly revision: number;
  readonly count: number;
  readonly ids: readonly DressingStableId[];
  readonly packed: Uint32Array;
  readonly positions: readonly (readonly [number, number])[];
}

export interface DestroyPersistentDressingInput {
  readonly stableId: DressingStableId;
  readonly classId: PersistentDressingClassId;
  readonly position: readonly [number, number, number];
}

let cachedStoreRevision = -1;
let cachedSignature = "";
let exclusionRevision = 0;
let cachedSnapshot: PersistentDressingExclusionSnapshot = emptySnapshot();
let cachedKeys = new Set<string>();

export function persistentDressingSaveId(stableId: DressingStableId): string {
  return `${DRESSING_SAVE_ID_PREFIX}${stableIdKey(stableId)}`;
}

export function parsePersistentDressingSaveId(value: string): DressingStableId | null {
  if (!value.startsWith(DRESSING_SAVE_ID_PREFIX)) return null;
  return parseStableIdKey(value.slice(DRESSING_SAVE_ID_PREFIX.length));
}

export function buildPersistentDressingExclusionSnapshot(
  props: readonly SavedPropInstance[],
  revision: number,
): PersistentDressingExclusionSnapshot {
  const entries = props
    .filter((prop) => prop.state === "destroyed" && prop.tags.includes(DRESSING_SAVE_TAG))
    .map((prop) => {
      const stableId = parsePersistentDressingSaveId(prop.id);
      if (!stableId) throw new Error(`invalid saved dressing exclusion ID: ${prop.id}`);
      return {
        stableId,
        position: [prop.position[0], prop.position[2]] as const,
      };
    })
    .sort((a, b) => compareStableIds(a.stableId, b.stableId));

  const ids = entries.map((entry) => entry.stableId);
  const packed = new Uint32Array(ids.length * 2);
  ids.forEach((id, index) => {
    packed[index * 2] = id.lo >>> 0;
    packed[index * 2 + 1] = id.hi >>> 0;
  });
  return {
    revision: revision >>> 0,
    count: ids.length,
    ids,
    packed,
    positions: entries.map((entry) => entry.position),
  };
}

export function readPersistentDressingExclusions(): PersistentDressingExclusionSnapshot {
  const storeRevision = savedPropStore.revision();
  if (storeRevision === cachedStoreRevision) return cachedSnapshot;
  const candidate = buildPersistentDressingExclusionSnapshot(savedPropStore.snapshot(), exclusionRevision);
  const signature = candidate.ids
    .map((id, index) => `${stableIdKey(id)}@${candidate.positions[index]![0]},${candidate.positions[index]![1]}`)
    .join("|");
  if (signature !== cachedSignature) {
    exclusionRevision = (exclusionRevision + 1) >>> 0;
    cachedSignature = signature;
  }
  cachedSnapshot = {
    ...candidate,
    revision: exclusionRevision,
  };
  cachedStoreRevision = storeRevision;
  cachedKeys = new Set(cachedSnapshot.ids.map(stableIdKey));
  return cachedSnapshot;
}

export function isPersistentDressingExcluded(stableId: DressingStableId): boolean {
  readPersistentDressingExclusions();
  return cachedKeys.has(stableIdKey(stableId));
}

export function isPersistentDressingExcludedAt(
  x: number,
  z: number,
  toleranceM = DEFAULT_POSITION_TOLERANCE_M,
): boolean {
  const toleranceSq = Math.max(0, toleranceM) ** 2;
  return readPersistentDressingExclusions().positions.some(([savedX, savedZ]) => {
    const dx = x - savedX;
    const dz = z - savedZ;
    return dx * dx + dz * dz <= toleranceSq;
  });
}

export function destroyPersistentDressing(input: DestroyPersistentDressingInput): string[] {
  if (!isPersistentDressingClass(input.classId)) {
    throw new Error(`only persistent dressing classes may be destroyed: ${input.classId}`);
  }
  const prop: SavedPropInstance = {
    id: persistentDressingSaveId(input.stableId),
    prefabId: `environmental-dressing:${input.classId}`,
    position: [input.position[0], input.position[1], input.position[2]],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    regionKey: regionKeyForWorld(input.position[0], input.position[2]),
    state: "destroyed",
    tags: ["environmental", DRESSING_SAVE_TAG, input.classId],
    revision: savedPropStore.revision() + 1,
  };
  return upsertSaveRuntimeProp(prop);
}

export function restorePersistentDressing(
  stableId: DressingStableId,
  position: readonly [number, number, number],
): string[] {
  return removeSaveRuntimeProp(persistentDressingSaveId(stableId), {
    minX: position[0],
    minZ: position[2],
    maxX: position[0],
    maxZ: position[2],
  });
}

function emptySnapshot(): PersistentDressingExclusionSnapshot {
  return {
    revision: 0,
    count: 0,
    ids: [],
    packed: new Uint32Array(0),
    positions: [],
  };
}

function compareStableIds(a: DressingStableId, b: DressingStableId): number {
  const high = (a.hi >>> 0) - (b.hi >>> 0);
  return high !== 0 ? high : (a.lo >>> 0) - (b.lo >>> 0);
}
