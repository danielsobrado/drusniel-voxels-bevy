import type { TreeSettings } from "./tree_config.js";
import type { TreeTerrainSampler } from "./tree_instances.js";
import {
  createTreeRingLightingProxyBuild,
  finishTreeRingLightingProxyBuild,
  generateTreeRingLightingProxies,
  stepTreeRingLightingProxyBuild,
  treeRingLightingProxyKey,
  type TreeRingLightingProxyBuild,
} from "./tree_ring_lighting_proxies.js";
import type { TreeLightingProxy } from "./tree_system_types.js";

export interface TreeGpuLightingProxyCacheInput {
  centerX: number;
  centerZ: number;
  worldCells: number;
  settings: TreeSettings;
  sampler?: TreeTerrainSampler;
}

export interface TreeGpuLightingProxyBudgetedResult {
  /** Shared cache array — callers must not mutate the proxies. */
  proxies: readonly TreeLightingProxy[];
  /** True when the proxies match the requested inputs (not a stale set). */
  ready: boolean;
}

export class TreeGpuLightingProxyCache {
  private current: { key: string; proxies: TreeLightingProxy[] } | null = null;
  private building: { key: string; build: TreeRingLightingProxyBuild } | null = null;

  clear(): void {
    this.current = null;
    this.building = null;
  }

  get(input: TreeGpuLightingProxyCacheInput): TreeLightingProxy[] {
    const key = treeRingLightingProxyKey(input);
    if (this.current?.key !== key) {
      this.current = {
        key,
        proxies: generateTreeRingLightingProxies(input),
      };
      this.building = null;
    }
    return this.current.proxies.map((proxy) => ({ ...proxy }));
  }

  /** Steps a slot-cursor proxy build within `deadlineMs`. Returns the last
   *  completed proxy set until the build for the requested inputs finishes; an
   *  in-progress build is never restarted on key drift (it completes, then the
   *  next call starts the fresh key), so continuous movement still converges. */
  getBudgeted(input: TreeGpuLightingProxyCacheInput, deadlineMs: number): TreeGpuLightingProxyBudgetedResult {
    const key = treeRingLightingProxyKey(input);
    if (this.current?.key === key) return { proxies: this.current.proxies, ready: true };
    if (!this.building) {
      this.building = { key, build: createTreeRingLightingProxyBuild(input) };
    }
    if (!stepTreeRingLightingProxyBuild(this.building.build, deadlineMs)) {
      return { proxies: this.current?.proxies ?? [], ready: false };
    }
    const built = { key: this.building.key, proxies: finishTreeRingLightingProxyBuild(this.building.build) };
    this.building = null;
    this.current = built;
    return { proxies: built.proxies, ready: built.key === key };
  }
}
