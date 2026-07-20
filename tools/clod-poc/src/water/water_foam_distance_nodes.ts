import { cameraPosition, float, mix, smoothstep, uniform } from "three/tsl";
import {
  getWaterFoamDistanceDebugOverride,
  getWaterFoamDistanceFadeState,
  subscribeWaterFoamDistanceDebugOverride,
  subscribeWaterFoamDistanceFade,
  type WaterFoamDistanceDebugOverrideState,
  type WaterFoamDistanceFadeState,
} from "./water_foam_distance.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export interface WaterFoamDistanceNodeOverrides {
  readonly cameraXZ?: TslNode;
  readonly startM?: TslNode;
  readonly endM?: TslNode;
}

interface SharedUniformState {
  readonly startM: TslNode;
  readonly endM: TslNode;
  readonly valid: TslNode;
  readonly debugEnabled: TslNode;
  readonly debugDistanceM: TslNode;
}

let shared: SharedUniformState | null = null;

export function buildWaterFoamDistanceFadeNode(
  worldXZ: TslNode,
  overrides: WaterFoamDistanceNodeOverrides = {},
): TslNode {
  const refs = getOrCreateSharedState();
  const hasStart = overrides.startM !== undefined;
  const hasEnd = overrides.endM !== undefined;
  if (hasStart !== hasEnd) {
    throw new Error("water foam distance node overrides require both startM and endM");
  }
  const cameraXZ = overrides.cameraXZ ?? cameraPosition.xz;
  const startM = overrides.startM ?? refs.startM;
  const endM = overrides.endM ?? refs.endM;
  const valid = hasStart && hasEnd ? float(1) : refs.valid;
  const measuredDistanceM = worldXZ.sub(cameraXZ).length();
  const distanceM = mix(measuredDistanceM, refs.debugDistanceM, refs.debugEnabled);
  const resolved = float(1).sub(smoothstep(startM, endM, distanceM));
  return mix(float(1), resolved, valid);
}

function syncSharedState(state: WaterFoamDistanceFadeState): void {
  if (!shared) return;
  shared.startM.value = state.startM;
  shared.endM.value = state.endM;
  shared.valid.value = state.valid ? 1 : 0;
}

function syncDebugOverride(state: WaterFoamDistanceDebugOverrideState): void {
  if (!shared) return;
  shared.debugEnabled.value = state.enabled ? 1 : 0;
  shared.debugDistanceM.value = state.distanceM;
}

function getOrCreateSharedState(): SharedUniformState {
  if (!shared) {
    const state = getWaterFoamDistanceFadeState();
    const debug = getWaterFoamDistanceDebugOverride();
    shared = {
      startM: uniform(state.startM) as TslNode,
      endM: uniform(state.endM) as TslNode,
      valid: uniform(state.valid ? 1 : 0) as TslNode,
      debugEnabled: uniform(debug.enabled ? 1 : 0) as TslNode,
      debugDistanceM: uniform(debug.distanceM) as TslNode,
    };
    subscribeWaterFoamDistanceFade(syncSharedState);
    subscribeWaterFoamDistanceDebugOverride(syncDebugOverride);
  }
  return shared;
}
