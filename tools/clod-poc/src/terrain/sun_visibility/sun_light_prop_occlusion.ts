import {
  largePropOcclusionPayloadRegion,
  type LargePropOcclusionHeightPayload,
  type LargePropOcclusionRegion,
} from "../../props/large_prop_occlusion_height.js";
import { readActiveLargePropOcclusionField } from "../../props/large_prop_occlusion_runtime.js";

export interface SunLightPropHeightState {
  readonly revision: number;
  readonly payload: LargePropOcclusionHeightPayload | null;
}

export function readSunLightPropHeightState(): SunLightPropHeightState {
  const field = readActiveLargePropOcclusionField();
  if (!field) return { revision: 0, payload: null };
  const stats = field.stats();
  return {
    revision: stats.activeRevision,
    payload: field.giHeightPayload(),
  };
}

export function changedSunLightPropRegions(
  previous: LargePropOcclusionHeightPayload | null,
  next: LargePropOcclusionHeightPayload | null,
): LargePropOcclusionRegion[] {
  const regions: LargePropOcclusionRegion[] = [];
  const previousRegion = largePropOcclusionPayloadRegion(previous);
  const nextRegion = largePropOcclusionPayloadRegion(next);
  if (previousRegion) regions.push(previousRegion);
  if (nextRegion && !sameRegion(previousRegion, nextRegion)) regions.push(nextRegion);
  return regions;
}

export function publishSunLightPropCounters(state: SunLightPropHeightState): void {
  const counters = (globalThis as typeof globalThis & {
    window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
  }).window?.__drusnielClod?.stats?.counters;
  if (!counters) return;
  counters["sun_light_prop_occlusion_revision"] = state.revision;
  counters["sun_light_prop_occlusion_cells"] = state.payload?.cellX.length ?? 0;
  counters["sun_light_prop_occlusion_readbacks"] = 0;
}

function sameRegion(
  a: LargePropOcclusionRegion | null,
  b: LargePropOcclusionRegion | null,
): boolean {
  return a !== null
    && b !== null
    && a.minX === b.minX
    && a.minZ === b.minZ
    && a.maxX === b.maxX
    && a.maxZ === b.maxZ;
}
