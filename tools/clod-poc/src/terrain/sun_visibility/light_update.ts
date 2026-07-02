import { worldToSunVisibilityTile } from "./sun_visibility_tile.js";
import { createTerrainSummaryLightHeightProvider } from "./far_light_height.js";
import { createSunLightCacheRuntime } from "./far_light_cache_runtime.js";
import { loadBundledSunLightOptions } from "./sun_light_config_loader.js";
import { createSunLightDebugOverlay } from "./sun_light_debug_overlay.js";

function applyQueryOverrides(options: ReturnType<typeof loadBundledSunLightOptions>): void {
  const searchParams = new URLSearchParams(location.search);
  if (searchParams.has("sunLightCache")) options.active = searchParams.get("sunLightCache") !== "0";
  if (searchParams.has("sunLightStats")) options.diagnostics = searchParams.get("sunLightStats") === "1";
  if (searchParams.has("sunLightDebug")) options.debugView.active = searchParams.get("sunLightDebug") === "1";
}

export function createLightUpdate(args: any) {
  const options = loadBundledSunLightOptions();
  applyQueryOverrides(options);
  const provider = createTerrainSummaryLightHeightProvider(args.terrainSummary);
  const cache = createSunLightCacheRuntime(options);
  const overlay = createSunLightDebugOverlay();
  const globals = window as unknown as Record<string, unknown>;
  globals.__drusnielSunLightOptions = options;
  globals.__drusnielSunLightStats = () => cache.stats();
  globals.__drusnielSunLightRefresh = () => cache.markAllStale();
  return {
    update(camera: any, sunVec: any, frameIndex: number, nowMs: number) {
      if (!options.active) {
        overlay.update([], options);
        return;
      }
      const centerTile = worldToSunVisibilityTile(camera.position.x, camera.position.z, options.tile);
      const radius = options.debugView.cameraTileRadius;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          cache.enqueueTile({ tileX: centerTile.tileX + dx, tileZ: centerTile.tileZ + dz, lod: 0 }, sunVec, frameIndex, provider);
        }
      }
      cache.updateBudgeted(provider, frameIndex, nowMs);
      overlay.update(cache.tiles(), options);
    },
    stats() {
      return cache.stats();
    },
    dispose() {
      overlay.dispose();
    },
  };
}
