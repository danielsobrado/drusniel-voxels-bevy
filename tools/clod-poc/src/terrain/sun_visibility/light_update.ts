import { worldToSunVisibilityTile } from "./sun_visibility_tile.js";
import { createTerrainSummaryLightHeightProvider } from "./far_light_height.js";
import { createSunLightCacheRuntime } from "./far_light_cache_runtime.js";
import { loadBundledSunLightOptions } from "./sun_light_config_loader.js";

export function createLightUpdate(args: any) {
  const options = loadBundledSunLightOptions();
  options.active = args.options.active;
  options.diagnostics = args.options.diagnostics;
  options.debugView.active = args.options.debugView.active;
  const provider = createTerrainSummaryLightHeightProvider(args.terrainSummary);
  const cache = createSunLightCacheRuntime(options);
  const globals = window as unknown as Record<string, unknown>;
  globals.__drusnielSunLightOptions = options;
  globals.__drusnielSunLightStats = () => cache.stats();
  globals.__drusnielSunLightRefresh = () => cache.markAllStale();
  return {
    update(camera: any, sunVec: any, frameIndex: number, nowMs: number) {
      if (!options.active) return;
      const centerTile = worldToSunVisibilityTile(camera.position.x, camera.position.z, options.tile);
      const radius = options.debugView.cameraTileRadius;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          cache.enqueueTile({ tileX: centerTile.tileX + dx, tileZ: centerTile.tileZ + dz, lod: 0 }, sunVec, frameIndex, provider);
        }
      }
      cache.updateBudgeted(provider, frameIndex, nowMs);
    },
    stats() {
      return cache.stats();
    },
  };
}
