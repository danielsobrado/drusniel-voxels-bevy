import type { ShadowProxyStats } from "./shadowProxyTypes.js";

export function createEmptyShadowProxyStats(): ShadowProxyStats {
  return {
    enabled: false,
    built: false,
    gridRes: 0,
    vertexCount: 0,
    triangleCount: 0,
    buildMs: 0,
    worldMinX: 0,
    worldMaxX: 0,
    worldMinZ: 0,
    worldMaxZ: 0,
    minHeight: 0,
    maxHeight: 0,
    castShadow: false,
    receiveShadow: false,
    mainPassColorWrite: false,
    mainPassDepthWrite: false,
  };
}

export interface ShadowProxyCounterInput {
  proxyEnabled: boolean;
  sunShadowsEnabled: boolean;
  stats: ShadowProxyStats;
  lightShadowMapSize: number;
  lightShadowCameraExtentM: number;
}

export function shadowProxyStatsToCounters(input: ShadowProxyCounterInput): Record<string, number> {
  const active = input.proxyEnabled && input.sunShadowsEnabled && input.stats.built;
  return {
    shadow_proxy_enabled: input.proxyEnabled && input.stats.built ? 1 : 0,
    shadow_proxy_inert: active ? 0 : 1,
    shadow_proxy_grid_res: input.stats.gridRes,
    shadow_proxy_tris: input.stats.triangleCount,
    shadow_proxy_build_ms: Math.round(input.stats.buildMs * 100) / 100,
    shadow_proxy_vertex_count: input.stats.vertexCount,
    shadow_map_size: input.lightShadowMapSize,
    shadow_camera_extent_m: input.lightShadowCameraExtentM,
  };
}

export function formatShadowProxyStatsLine(stats: ShadowProxyStats): string {
  if (!stats.built) return "shadow proxy: not built";
  return [
    `grid ${stats.gridRes}`,
    `verts ${stats.vertexCount}`,
    `tris ${stats.triangleCount}`,
    `build ${stats.buildMs.toFixed(1)}ms`,
    `h ${stats.minHeight.toFixed(1)}..${stats.maxHeight.toFixed(1)}`,
    `xz ${stats.worldMinX.toFixed(0)}..${stats.worldMaxX.toFixed(0)}`,
  ].join(" | ");
}
