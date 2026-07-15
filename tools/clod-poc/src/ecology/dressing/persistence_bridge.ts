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
    this.deltas.clear();
    this.exclusions.clear();
    for (const delta of deltas) this.recordSerialized(delta);
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
    if (!isPersistentDressingClass(delta.classId as DressingClassId)) {
      throw new Error(`only persistent dressing classes may be saved: ${delta.classId}`);
    }
    if (!/^[0-9a-f]{16}$/i.test(delta.stableId)) throw new Error(`invalid dressing stable ID: ${delta.stableId}`);
    if ((delta.state === "moved" || delta.state === "replaced") && !delta.transformOverride) {
      throw new Error(`${delta.state} dressing delta requires transformOverride`);
    }
    this.deltas.set(delta.stableId, cloneDelta(delta));
    if (delta.state === "destroyed" || delta.state === "harvested") this.exclusions.add(delta.stableId);
    else this.exclusions.delete(delta.stableId);
  }

  isExcluded(stableId: DressingStableId): boolean {
    return this.exclusions.has(stableIdKey(stableId));
  }

  snapshot(): EnvironmentalPropDelta[] {
    return [...this.deltas.values()].sort((a, b) => a.stableId.localeCompare(b.stableId)).map(cloneDelta);
  }
}

function cloneDelta(delta: EnvironmentalPropDelta): EnvironmentalPropDelta {
  return {
    ...delta,
    transformOverride: delta.transformOverride ? {
      position: [...delta.transformOverride.position],
      rotation: [...delta.transformOverride.rotation],
      scale: [...delta.transformOverride.scale],
    } : undefined,
    payload: delta.payload ? { ...delta.payload } : undefined,
  };
}
