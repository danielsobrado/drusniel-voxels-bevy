import type * as THREE from "three";
import type { TerrainSummaryField } from "../../clod/terrain_summary.js";
import { getTerrainFieldConfig } from "../terrain.js";
import { worldToSunVisibilityTile } from "./sun_visibility_tile.js";
import { createTerrainEditChangeTracker, createTerrainSummaryLightHeightProvider } from "./far_light_height.js";
import { createSunLightCacheRuntime } from "./far_light_cache_runtime.js";
import { loadBundledSunLightOptions } from "./sun_light_config_loader.js";
import { createSunLightDebugOverlay } from "./sun_light_debug_overlay.js";
import { invalidateSunLightGpuAtlas, updateSunLightGpuAtlas } from "./sun_light_gpu_atlas.js";
import {
  changedSunLightPropRegions,
  publishSunLightPropCounters,
  readSunLightPropHeightState,
} from "./sun_light_prop_occlusion.js";
import { sunBinKey, toSunBin } from "./sun_bins.js";
import { createSunLightRemoteTileBuilder } from "./sun_light_worker_client.js";

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
  propKey: string;
  tileX: number;
  tileZ: number;
  sunBin: string;
}): string {
  return `${input.terrainRevision}|${input.propKey}|${input.tileX},${input.tileZ}|${input.sunBin}`;
}

function safeTerrainFieldConfig(): ReturnType<typeof getTerrainFieldConfig> | null {
  try {
    return getTerrainFieldConfig();
  } catch {
    return null;
  }
}

export function createLightUpdate(args: LightUpdateArgs) {
  const options = loadBundledSunLightOptions();
  applyQueryOverrides(options);
  const provider = createTerrainSummaryLightHeightProvider(args.terrainSummary);
  const changeTracker = createTerrainEditChangeTracker();
  let propHeightState = readSunLightPropHeightState();
  provider.setPropOcclusion(propHeightState.payload);
  // Tile builds cost seconds of CPU each; the worker keeps them off the main thread.
  // The worker samples immutable terrain and committed prop-height snapshots, so it must
  // be reconfigured whenever either source revision changes.
  const remote = options.active ? createSunLightRemoteTileBuilder() : null;
  const configureRemote = (): void => {
    remote?.configure({
      terrainFieldConfig: safeTerrainFieldConfig(),
      summary: {
        res: args.terrainSummary.res,
        worldSize: args.terrainSummary.worldSize,
        heightMax: args.terrainSummary.heightMax,
      },
      propOcclusion: propHeightState.payload,
      options,
    });
  };
  configureRemote();
  const cache = createSunLightCacheRuntime(options, remote);
  const overlay = createSunLightDebugOverlay();
  let lastTerrainRevision = provider.terrainRevision();
  let lastStableFrameKey = "";
  let lastAtlasSignature = "";
  const globals = window as unknown as Record<string, unknown>;
  globals.__drusnielSunLightOptions = options;
  globals.__drusnielSunLightStats = () => cache.stats();
  globals.__drusnielSunLightRefresh = () => {
    propHeightState = readSunLightPropHeightState();
    provider.setPropOcclusion(propHeightState.payload);
    cache.markAllStale();
    invalidateSunLightGpuAtlas();
    configureRemote();
    lastStableFrameKey = "";
    lastAtlasSignature = "";
  };
  globals.__drusnielSunLightPeekWorld = (x: number, z: number, sunVec: THREE.Vector3) => cache.peekWorld(x, z, sunVec, provider);
  return {
    update(camera: THREE.PerspectiveCamera, sunVec: THREE.Vector3, frameIndex: number, nowMs: number) {
      globals.__drusnielSunLightSunDirection = sunVec.clone();
      const terrainRevision = provider.terrainRevision();
      if (terrainRevision !== lastTerrainRevision) {
        // The global revision also bumps on world rebuilds and snapshot reloads
        // that change no voxels (constant during infinite-islands streaming), so
        // invalidate only the tiles reachable from regions with new edit deltas.
        const changedRegions = changeTracker.consumeChangedRegions();
        if (changedRegions === null) {
          cache.markAllStale();
          invalidateSunLightGpuAtlas();
          configureRemote();
          lastAtlasSignature = "";
        } else if (changedRegions.length > 0) {
          cache.invalidateRegions(changedRegions);
          // Rebuilds must sample post-edit heights; refresh the worker's snapshot.
          configureRemote();
        }
        lastTerrainRevision = terrainRevision;
        lastStableFrameKey = "";
      }

      const nextPropHeightState = readSunLightPropHeightState();
      if (nextPropHeightState.key !== propHeightState.key) {
        const regions = changedSunLightPropRegions(propHeightState.payload, nextPropHeightState.payload);
        propHeightState = nextPropHeightState;
        provider.setPropOcclusion(propHeightState.payload);
        if (regions.length > 0) cache.invalidateRegions(regions);
        configureRemote();
        lastStableFrameKey = "";
      }

      publishSunLightPropCounters(propHeightState);
      if (!options.active) {
        invalidateSunLightGpuAtlas();
        overlay.update([], options);
        lastStableFrameKey = "";
        lastAtlasSignature = "";
        return;
      }
      const centerTile = worldToSunVisibilityTile(camera.position.x, camera.position.z, options.tile);
      const sunBin = sunBinKey(toSunBin(sunVec, options.directionBins));
      const frameKey = stableFrameKey({
        terrainRevision,
        propKey: propHeightState.key,
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
      // Repacking and re-uploading the full atlas is a per-frame allocation and
      // GPU transfer; skip it unless the built tile set or the window moved.
      const atlasSignature = `${centerTile.tileX},${centerTile.tileZ}|${cache.contentRevision()}|${options.build.materialTileRadius}`;
      if (atlasSignature !== lastAtlasSignature) {
        updateSunLightGpuAtlas(centerTile, cache.tiles(), options);
        lastAtlasSignature = atlasSignature;
      }
      overlay.update(cache.tiles(), options);
      lastStableFrameKey = cache.stats().pendingTiles === 0 ? frameKey : "";
    },
    stats() {
      return cache.stats();
    },
    dispose() {
      remote?.dispose();
      overlay.dispose();
      invalidateSunLightGpuAtlas();
      lastStableFrameKey = "";
      lastAtlasSignature = "";
    },
  };
}
