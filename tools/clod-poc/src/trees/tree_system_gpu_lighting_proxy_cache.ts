import type { TreeSettings } from "./tree_config.js";
import type { TreeTerrainSampler } from "./tree_instances.js";
import {
  generateTreeRingLightingProxies,
  treeRingLightingProxyKey,
} from "./tree_ring_lighting_proxies.js";
import type { TreeLightingProxy } from "./tree_system_types.js";

export interface TreeGpuLightingProxyCacheInput {
  centerX: number;
  centerZ: number;
  worldCells: number;
  settings: TreeSettings;
  sampler?: TreeTerrainSampler;
}

export class TreeGpuLightingProxyCache {
  private current: { key: string; proxies: TreeLightingProxy[] } | null = null;

  clear(): void {
    this.current = null;
  }

  get(input: TreeGpuLightingProxyCacheInput): TreeLightingProxy[] {
    const key = treeRingLightingProxyKey(input);
    if (this.current?.key !== key) {
      this.current = {
        key,
        proxies: generateTreeRingLightingProxies(input),
      };
    }
    return this.current.proxies.map((proxy) => ({ ...proxy }));
  }
}
