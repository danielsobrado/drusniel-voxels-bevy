import type * as THREE from "three";
import {
  abs,
  clamp,
  float,
  mix,
  smoothstep,
  step,
  texture,
  uniform,
  vec2,
} from "three/tsl";
import {
  getSunLightGpuAtlas,
  subscribeSunLightGpuAtlas,
  type SunLightGpuAtlasState,
} from "./sun_light_gpu_atlas.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const ATLAS_EDGE_EPSILON = 0.0001;
const MISSING_VISIBILITY_CENTER = 0.5;
const MISSING_VISIBILITY_TOLERANCE_START = 0.08;
const MISSING_VISIBILITY_TOLERANCE_END = 0.20;

export interface SunLightGpuAtlasNodes {
  readonly visibility: TslNode;
  readonly atlasInside: TslNode;
}

export interface SunLightGpuAtlasDebugOverrideState {
  readonly enabled: boolean;
  readonly visibility: number;
}

interface SharedUniformState {
  readonly texture: THREE.Texture;
  readonly originX: TslNode;
  readonly originZ: TslNode;
  readonly worldSize: TslNode;
  readonly valid: TslNode;
  readonly debugOverrideEnabled: TslNode;
  readonly debugOverrideVisibility: TslNode;
}

let shared: SharedUniformState | null = null;
let debugOverrideEnabled = 0;
let debugOverrideVisibility = 1;

export function buildSunLightGpuAtlasNodes(worldXZ: TslNode): SunLightGpuAtlasNodes {
  const refs = getOrCreateSharedState();
  const worldUv = vec2(
    worldXZ.x.sub(refs.originX).div(refs.worldSize.max(ATLAS_EDGE_EPSILON)),
    worldXZ.y.sub(refs.originZ).div(refs.worldSize.max(ATLAS_EDGE_EPSILON)),
  );
  const uv = vec2(
    clamp(worldUv.x, float(0), float(1)),
    clamp(worldUv.y, float(0), float(1)),
  );
  const atlasInside = step(float(0), worldUv.x)
    .mul(step(worldUv.x, float(1)))
    .mul(step(float(0), worldUv.y))
    .mul(step(worldUv.y, float(1)))
    .mul(refs.valid);
  const sampled = texture(refs.texture, uv).r;
  const knownSample = smoothstep(
    MISSING_VISIBILITY_TOLERANCE_START,
    MISSING_VISIBILITY_TOLERANCE_END,
    abs(sampled.sub(MISSING_VISIBILITY_CENTER)),
  );
  const resolvedSample = (mix as (...args: TslNode[]) => TslNode)(float(1), sampled, knownSample);
  const atlasVisibility = (mix as (...args: TslNode[]) => TslNode)(float(1), resolvedSample, atlasInside);
  const visibility = (mix as (...args: TslNode[]) => TslNode)(
    atlasVisibility,
    refs.debugOverrideVisibility,
    refs.debugOverrideEnabled,
  );
  return { visibility, atlasInside };
}

export function setSunLightGpuAtlasDebugOverride(
  value: number | null,
): SunLightGpuAtlasDebugOverrideState {
  if (value === null) {
    debugOverrideEnabled = 0;
    debugOverrideVisibility = 1;
  } else {
    if (!Number.isFinite(value)) throw new Error("sun-light GPU atlas debug override must be finite or null");
    debugOverrideEnabled = 1;
    debugOverrideVisibility = Math.min(1, Math.max(0, value));
  }
  if (shared) {
    shared.debugOverrideEnabled.value = debugOverrideEnabled;
    shared.debugOverrideVisibility.value = debugOverrideVisibility;
  }
  return {
    enabled: debugOverrideEnabled > 0,
    visibility: debugOverrideVisibility,
  };
}

function syncSharedState(source: SunLightGpuAtlasState): void {
  if (!shared) return;
  if (shared.texture !== source.texture) throw new Error("sun-light GPU atlas texture identity changed");
  shared.originX.value = source.originX;
  shared.originZ.value = source.originZ;
  shared.worldSize.value = Math.max(ATLAS_EDGE_EPSILON, source.worldSize);
  shared.valid.value = source.valid;
}

function getOrCreateSharedState(): SharedUniformState {
  if (!shared) {
    const source = getSunLightGpuAtlas();
    shared = {
      texture: source.texture,
      originX: uniform(source.originX) as TslNode,
      originZ: uniform(source.originZ) as TslNode,
      worldSize: uniform(Math.max(ATLAS_EDGE_EPSILON, source.worldSize)) as TslNode,
      valid: uniform(source.valid) as TslNode,
      debugOverrideEnabled: uniform(debugOverrideEnabled) as TslNode,
      debugOverrideVisibility: uniform(debugOverrideVisibility) as TslNode,
    };
    subscribeSunLightGpuAtlas(syncSharedState);
  }
  return shared;
}
