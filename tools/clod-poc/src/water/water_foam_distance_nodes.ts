import { cameraPosition, float, mix, smoothstep, uniform } from "three/tsl";
import {
  getWaterFoamDistanceFadeState,
  subscribeWaterFoamDistanceFade,
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
}

let shared: SharedUniformState | null = null;

export function buildWaterFoamDistanceFadeNode(
  worldXZ: TslNode,
  overrides: WaterFoamDistanceNodeOverrides = {},
): TslNode {
  const refs = getOrCreateSharedState();
  const cameraXZ = overrides.cameraXZ ?? cameraPosition.xz;
  const startM = overrides.startM ?? refs.startM;
  const endM = overrides.endM ?? refs.endM;
  const valid = overrides.startM && overrides.endM ? float(1) : refs.valid;
  const distanceM = worldXZ.sub(cameraXZ).length();
  const resolved = float(1).sub(smoothstep(startM, endM, distanceM));
  return mix(float(1), resolved, valid);
}

function syncSharedState(state: WaterFoamDistanceFadeState): void {
  if (!shared) return;
  shared.startM.value = state.startM;
  shared.endM.value = state.endM;
  shared.valid.value = state.valid ? 1 : 0;
}

function getOrCreateSharedState(): SharedUniformState {
  if (!shared) {
    const state = getWaterFoamDistanceFadeState();
    shared = {
      startM: uniform(state.startM) as TslNode,
      endM: uniform(state.endM) as TslNode,
      valid: uniform(state.valid ? 1 : 0) as TslNode,
    };
    subscribeWaterFoamDistanceFade(syncSharedState);
  }
  return shared;
}
