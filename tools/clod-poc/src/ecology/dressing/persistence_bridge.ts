import {
  isPersistentDressingClass,
  type DressingClassId,
  type PersistentDressingClassId,
} from "./class_registry.js";
import { stableIdKey } from "./stable_id.js";
import type { DressingStableId, EnvironmentalPropDelta, SerializedTransform } from "./types.js";

export interface DressingDeltaInput {
  readonly stableId: DressingStableId;
  readonly classId: PersistentDressingClassId;
  readonly state: EnvironmentalPropDelta["state"];
  readonly transformOverride?: SerializedTransform;
  readonly payload?: Record<string, unknown>;
}

export class DressingPersistenceBridge {
  private readonly deltas = new Map<string, EnvironmentalPropDelta>();
  private readonly exclusions = new Set<string>();

  restore(deltas: readonly EnvironmentalPropDelta[]): void {
    const nextDeltas = new Map<string, EnvironmentalPropDelta>();
    const nextExclusions = new Set<string>();
    for (const delta of deltas) {
      const validated = validateSerializedDelta(delta);
      if (nextDeltas.has(validated.stableId)) throw new Error(`duplicate dressing stable ID: ${validated.stableId}`);
      nextDeltas.set(validated.stableId, validated);
      if (validated.state === "destroyed" || validated.state === "harvested") nextExclusions.add(validated.stableId);
    }
    this.deltas.clear();
    this.exclusions.clear();
    for (const [id, delta] of nextDeltas) this.deltas.set(id, delta);
    for (const id of nextExclusions) this.exclusions.add(id);
  }

  record(input: DressingDeltaInput): void {
    const key = stableIdKey(input.stableId);
    this.recordSerialized({
      stableId: key,
      classId: input.classId,
      state: input.state,
      transformOverride: input.transformOverride,
      payload: input.payload,
    });
  }

  private recordSerialized(delta: EnvironmentalPropDelta): void {
    const validated = validateSerializedDelta(delta);
    this.deltas.set(validated.stableId, validated);
    if (validated.state === "destroyed" || validated.state === "harvested") this.exclusions.add(validated.stableId);
    else this.exclusions.delete(validated.stableId);
  }

  isExcluded(stableId: DressingStableId): boolean {
    return this.exclusions.has(stableIdKey(stableId));
  }

  snapshot(): EnvironmentalPropDelta[] {
    return [...this.deltas.values()].sort((a, b) => a.stableId.localeCompare(b.stableId)).map(cloneDelta);
  }
}

function validateSerializedDelta(delta: EnvironmentalPropDelta): EnvironmentalPropDelta {
  if (!isPersistentDressingClass(delta.classId as DressingClassId)) {
    throw new Error(`only persistent dressing classes may be saved: ${delta.classId}`);
  }
  if (!/^[0-9a-f]{16}$/i.test(delta.stableId)) throw new Error(`invalid dressing stable ID: ${delta.stableId}`);
  if ((delta.state === "moved" || delta.state === "replaced") && !delta.transformOverride) {
    throw new Error(`${delta.state} dressing delta requires transformOverride`);
  }
  return cloneDelta(delta);
}

function cloneDelta(delta: EnvironmentalPropDelta): EnvironmentalPropDelta {
  return {
    ...delta,
    transformOverride: delta.transformOverride ? {
      position: [...delta.transformOverride.position],
      rotation: [...delta.transformOverride.rotation],
      scale: [...delta.transformOverride.scale],
    } : undefined,
    payload: delta.payload ? structuredClone(delta.payload) : undefined,
  };
}
