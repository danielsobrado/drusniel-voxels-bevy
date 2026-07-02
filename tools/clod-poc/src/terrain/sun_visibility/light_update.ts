import { worldToSunVisibilityTile } from "./sun_visibility_tile.js";
import { createTerrainSummaryLightHeightProvider } from "./far_light_height.js";
import { createSunLightCacheRuntime } from "./far_light_cache_runtime.js";

export function createLightUpdate(args: any) {
  const provider = createTerrainSummaryLightHeightProvider(args.terrainSummary);
  const cache = createSunLightCacheRuntime(args.options);
  return {
    update(camera: any, sunVec: any, frameIndex: number, nowMs: number) {
      if (!args.options.active) return;
      const centerTile = worldToSunVisibilityTile(camera.position.x, camera.position.z, args.options.tile);
      const radius = args.options.debugView.cameraTileRadius;
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
