// Pure worker-side build logic for sun-light tiles, importable by the parity test.
// The actual Worker entry (sun_light_build_worker.ts) is a thin shell around this.

import { surfaceHeightCore } from "../../gpu/terrain_field_core.js";
import { createSunLightHeightSampler } from "./far_light_height.js";
import { buildLightTile, type LightTileHeightSource } from "./light_builder.js";
import type { SunLightOptions } from "./sun_light_options.js";
import type {
  SunLightWorkerBuiltTile,
  SunLightWorkerConfigureRequest,
  SunLightWorkerTileRequest,
} from "./sun_light_worker_protocol.js";

export interface SunLightWorkerState {
  configId: number;
  options: SunLightOptions;
  heightSource: LightTileHeightSource;
}

export function sunLightWorkerStateFromConfigure(request: SunLightWorkerConfigureRequest): SunLightWorkerState {
  const terrainConfig = request.terrainFieldConfig;
  const analytic = terrainConfig
    ? (x: number, z: number) => surfaceHeightCore(x, z, terrainConfig)
    : (x: number, z: number) => surfaceHeightCore(x, z);
  const heightAt = request.summary
    ? createSunLightHeightSampler(request.summary.res, request.summary.worldSize, request.summary.heightMax, analytic)
    : analytic;
  return {
    configId: request.configId,
    options: request.options,
    heightSource: { heightAt },
  };
}

export function buildSunLightWorkerTiles(
  state: SunLightWorkerState,
  tiles: readonly SunLightWorkerTileRequest[],
): SunLightWorkerBuiltTile[] {
  return tiles.map((tile) => {
    const built = buildLightTile({
      tile: { tileX: tile.tileX, tileZ: tile.tileZ, lod: tile.lod },
      sunVec: { x: tile.sunVec[0], y: tile.sunVec[1], z: tile.sunVec[2] },
      sunBin: tile.sunBin,
      terrainRevision: tile.terrainRevision,
      frameIndex: tile.frameIndex,
    }, state.heightSource, state.options);
    return { key: tile.key, resolution: built.resolution, values: built.values };
  });
}
