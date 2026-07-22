import type { UnderstorySettings } from "./understory_config.js";
import {
  defaultUnderstoryTerrainSampler,
  type UnderstoryTerrainSampler,
} from "./understory_instances.js";
import {
  understoryRingAcceptParams,
  understoryRingCell,
  understoryRingTerrainGate,
} from "./understory_ring_math.js";
import { sampleUnderstoryEcology } from "./understory_ecology.js";
import { clamp01 } from "../trees/tree_noise.js";
import type { UnderstoryLightingProxy } from "./understory_system_support.js";

export const GPU_LIGHTING_PROXY_REFRESH_M = 8;
export const GPU_LIGHTING_PROXY_STEP_CELLS = 3;
/** Grid points sampled between deadline checks; also the minimum progress per step. */
export const GPU_LIGHTING_PROXY_POINT_CHECK_INTERVAL = 16;

/** Resumable state for the sparse ecology scan behind the GPU-ring lighting
 *  proxies: walking the ring samples the streamed terrain hundreds of times,
 *  which is too slow for one frame at the forest-lighting budget. */
export interface UnderstoryGpuLightingProxyBuild {
  key: string;
  centerX: number;
  centerZ: number;
  step: number;
  radius: number;
  dx: number;
  dz: number;
  proxies: UnderstoryLightingProxy[];
}

export interface UnderstoryGpuLightingProxyInput {
  centerX: number;
  centerZ: number;
  settings: UnderstorySettings;
  sampler?: UnderstoryTerrainSampler;
}

export function understoryGpuLightingProxyKey(input: UnderstoryGpuLightingProxyInput): string {
  return [
    Math.round(input.centerX / GPU_LIGHTING_PROXY_REFRESH_M),
    Math.round(input.centerZ / GPU_LIGHTING_PROXY_REFRESH_M),
    input.settings.seed,
    input.settings.distanceM,
    input.settings.placement.spacingM,
    input.settings.ecology.enabled ? 1 : 0,
  ].join("|");
}

export function createUnderstoryGpuLightingProxyBuild(input: UnderstoryGpuLightingProxyInput): UnderstoryGpuLightingProxyBuild {
  const radius = input.settings.distanceM;
  return {
    key: understoryGpuLightingProxyKey(input),
    centerX: input.centerX,
    centerZ: input.centerZ,
    step: Math.max(1, understoryRingCell(input.settings) * GPU_LIGHTING_PROXY_STEP_CELLS),
    radius,
    dx: -radius,
    dz: -radius,
    proxies: [],
  };
}

/** Advance the sparse ecology grid scan until `deadlineMs`; at least one grid
 *  point of progress is made per call. Returns true when the scan completed. */
export function stepUnderstoryGpuLightingProxyBuild(
  build: UnderstoryGpuLightingProxyBuild,
  settings: UnderstorySettings,
  sampler: UnderstoryTerrainSampler | undefined,
  deadlineMs: number,
): boolean {
  const terrain = sampler ?? defaultUnderstoryTerrainSampler;
  const acceptParams = understoryRingAcceptParams(settings);
  const radiusSq = build.radius * build.radius;
  let sinceCheck = 0;
  while (build.dz <= build.radius) {
    while (build.dx <= build.radius) {
      const dx = build.dx;
      const dz = build.dz;
      build.dx += build.step;
      if (dx * dx + dz * dz > radiusSq) continue;
      const wx = build.centerX + dx;
      const wz = build.centerZ + dz;
      const height = terrain.surfaceHeight(wx, wz);
      const normalY = terrain.surfaceNormal(wx, wz)[1];
      const ground = understoryRingTerrainGate(height, normalY, acceptParams);
      if (ground >= 0) {
        const ecology = sampleUnderstoryEcology(wx, wz, height, normalY, ground, settings);
        if (ecology.density > 0.05) {
          build.proxies.push({
            x: wx,
            z: wz,
            classId: "shrub",
            scale: 1,
            densityWeight: clamp01(ecology.density),
          });
        }
      }
      if (++sinceCheck >= GPU_LIGHTING_PROXY_POINT_CHECK_INTERVAL) {
        sinceCheck = 0;
        if (performance.now() >= deadlineMs) return false;
      }
    }
    build.dx = -build.radius;
    build.dz += build.step;
  }
  return true;
}

export function generateUnderstoryGpuLightingProxies(input: UnderstoryGpuLightingProxyInput): UnderstoryLightingProxy[] {
  const build = createUnderstoryGpuLightingProxyBuild(input);
  stepUnderstoryGpuLightingProxyBuild(build, input.settings, input.sampler, Number.POSITIVE_INFINITY);
  return build.proxies;
}

export interface UnderstoryGpuLightingProxyBudgetedResult {
  proxies: readonly UnderstoryLightingProxy[];
  ready: boolean;
}

/** Cache + deadline-bounded builder for GPU-ring lighting proxies. */
export class UnderstoryGpuLightingProxyCache {
  private current: { key: string; proxies: UnderstoryLightingProxy[] } | null = null;
  private building: UnderstoryGpuLightingProxyBuild | null = null;

  clear(): void {
    this.current = null;
    this.building = null;
  }

  get(input: UnderstoryGpuLightingProxyInput): UnderstoryLightingProxy[] {
    const key = understoryGpuLightingProxyKey(input);
    if (this.current?.key === key) return this.current.proxies;
    const build = createUnderstoryGpuLightingProxyBuild(input);
    stepUnderstoryGpuLightingProxyBuild(build, input.settings, input.sampler, Number.POSITIVE_INFINITY);
    this.building = null;
    this.current = { key, proxies: build.proxies };
    return build.proxies;
  }

  /** An in-progress build is never restarted on key drift: it completes, then
   *  the next call starts the fresh key, so continuous movement still converges. */
  getBudgeted(input: UnderstoryGpuLightingProxyInput, deadlineMs: number): UnderstoryGpuLightingProxyBudgetedResult {
    const key = understoryGpuLightingProxyKey(input);
    if (this.current?.key === key) return { proxies: this.current.proxies, ready: true };
    if (!this.building) this.building = createUnderstoryGpuLightingProxyBuild(input);
    const build = this.building;
    if (!stepUnderstoryGpuLightingProxyBuild(build, input.settings, input.sampler, deadlineMs)) {
      return { proxies: this.current?.proxies ?? [], ready: false };
    }
    this.building = null;
    this.current = { key: build.key, proxies: build.proxies };
    return { proxies: build.proxies, ready: build.key === key };
  }
}
