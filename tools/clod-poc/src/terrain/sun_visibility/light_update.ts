import type * as THREE from "three";
import type { TerrainSummaryField } from "../../clod/terrain_summary.js";
import { worldToSunVisibilityTile } from "./sun_visibility_tile.js";
import { createTerrainSummaryLightHeightProvider } from "./far_light_height.js";
import { createSunLightCacheRuntime } from "./far_light_cache_runtime.js";
import { loadBundledSunLightOptions } from "./sun_light_config_loader.js";
import { createSunLightDebugOverlay } from "./sun_light_debug_overlay.js";
import { invalidateSunLightGpuAtlas, updateSunLightGpuAtlas } from "./sun_light_gpu_atlas.js";
import { sunBinKey, toSunBin } from "./sun_bins.js";

interface LightUpdateArgs {
  terrainSummary: TerrainSummaryField;
  options?: unknown;
}

function applyQueryOverrides(options: ReturnType<typeof loadBundledSunLightOptions>): void {
  const searchParams = new URLSearchParams(location.search);
  if (searchParams.has("sunLightCache")) options.active = searchParams.get("sunLightCache") !== "0";
  if (searchParams.has("sunLightStats")) options.diagnostics = searchParams.get("sunLightStats") === "1";
  if (searchParams.has("sunLightDebug")) options.debugView.active = searchParams.get("sunLightDebug") === "1";
}

function stableFrameKey(input: {
  terrainRevision: number;
  tileX: number;
  tileZ: number;
  sunBin: string;
}): string {
  return `${input.terrainRevision}|${input.tileX},${input.tileZ}|${input.sunBin}`;
}

export function createLightUpdate(args: LightUpdateArgs) {
  const options = loadBundledSunLightOptions();
  applyQueryOverrides(options);
  const provider = createTerrainSummaryLightHeightProvider(args.terrainSummary);
  const cache = createSunLightCacheRuntime(options);
  const overlay = createSunLightDebugOverlay();
  let lastTerrainRevision = provider.terrainRevision();
  let lastStableFrameKey = "";
  const globals = window as unknown as Record<string, unknown>;
  globals.__drusnielSunLightOptions = options;
  globals.__drusnielSunLightStats = () => cache.stats();
  globals.__drusnielSunLightRefresh = () => {
    cache.markAllStale();
    invalidateSunLightGpuAtlas();
    lastStableFrameKey = "";
  };
  globals.__drusnielSunLightPeekWorld = (x: number, z: number, sunVec: THREE.Vector3) => cache.peekWorld(x, z, sunVec, provider);
  return {
    update(camera: THREE.PerspectiveCamera, sunVec: THREE.Vector3, frameIndex: number, nowMs: number) {
      globals.__drusnielSunLightSunDirection = sunVec.clone();
      const terrainRevision = provider.terrainRevision();
      if (terrainRevision !== lastTerrainRevision) {
        cache.markAllStale();
        invalidateSunLightGpuAtlas();
        lastTerrainRevision = terrainRevision;
        lastStableFrameKey = "";
      }
      if (!options.active) {
        invalidateSunLightGpuAtlas();
        overlay.update([], options);
        lastStableFrameKey = "";
        return;
      }
      const centerTile = worldToSunVisibilityTile(camera.position.x, camera.position.z, options.tile);
      const sunBin = sunBinKey(toSunBin(sunVec, options.directionBins));
      const frameKey = stableFrameKey({
        terrainRevision,
        tileX: centerTile.tileX,
        tileZ: centerTile.tileZ,
        sunBin,
      });
      if (!options.debugView.active && frameKey === lastStableFrameKey && cache.stats().pendingTiles === 0) {
        return;
      }
      const materialRadius = options.build.materialTileRadius;
      for (let dz = -materialRadius; dz <= materialRadius; dz++) {
        for (let dx = -materialRadius; dx <= materialRadius; dx++) {
          cache.enqueueTile({ tileX: centerTile.tileX + dx, tileZ: centerTile.tileZ + dz, lod: 0 }, sunVec, frameIndex, provider);
        }
      }
      cache.updateBudgeted(provider, frameIndex, nowMs, centerTile);
      updateSunLightGpuAtlas(centerTile, cache.tiles(), options);
      overlay.update(cache.tiles(), options);
      lastStableFrameKey = cache.stats().pendingTiles === 0 ? frameKey : "";
    },
    stats() {
      return cache.stats();
    },
    dispose() {
      overlay.dispose();
      invalidateSunLightGpuAtlas();
      lastStableFrameKey = "";
    },
  };
}
