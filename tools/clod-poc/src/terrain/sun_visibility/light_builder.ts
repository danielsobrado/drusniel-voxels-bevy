import * as THREE from "three";
import { sunVisibilityTileCellCenter, type SunVisibilityTileKey } from "./sun_visibility_tile.js";
import type { SunDirectionBin } from "./sun_bins.js";
import type { createTerrainSummaryLightHeightProvider } from "./far_light_height.js";
import type { SunLightOptions } from "./sun_light_options.js";

export const LIGHT_SAMPLE = {
  missing: 0,
  lit: 1,
  shaded: 2,
} as const;

export interface LightTileBuildRequest {
  tile: SunVisibilityTileKey;
  sunVec: THREE.Vector3;
  sunBin: SunDirectionBin;
  terrainRevision: number;
  frameIndex: number;
}

export interface LightTile {
  key: SunVisibilityTileKey;
  sunBin: SunDirectionBin;
  terrainRevision: number;
  resolution: number;
  values: Uint8Array;
  builtAtFrame: number;
}

export function buildLightTile(
  request: LightTileBuildRequest,
  provider: ReturnType<typeof createTerrainSummaryLightHeightProvider>,
  options: SunLightOptions,
): LightTile {
  const resolution = options.tile.resolution;
  const values = new Uint8Array(resolution * resolution);
  const sun = request.sunVec.clone().normalize();
  const horizontalLength = Math.hypot(sun.x, sun.z);

  for (let cellZ = 0; cellZ < resolution; cellZ++) {
    for (let cellX = 0; cellX < resolution; cellX++) {
      const index = cellZ * resolution + cellX;
      const receiver = sunVisibilityTileCellCenter(request.tile, cellX, cellZ, options.tile);
      const receiverHeight = provider.readHeight(receiver.x, receiver.z);
      if (!receiverHeight.present) {
        values[index] = LIGHT_SAMPLE.missing;
        continue;
      }
      if (horizontalLength < 0.001) {
        values[index] = LIGHT_SAMPLE.lit;
        continue;
      }

      const stepX = sun.x / horizontalLength;
      const stepZ = sun.z / horizontalLength;
      const slope = sun.y / Math.max(horizontalLength, 0.001);
      const originY = receiverHeight.height + options.ray.receiverHeightBias;
      let shaded = false;
      let missing = false;

      for (let distance = options.ray.stepWorld; distance <= options.ray.maxDistanceWorld; distance += options.ray.stepWorld) {
        const sx = receiver.x + stepX * distance;
        const sz = receiver.z + stepZ * distance;
        const rayY = originY + slope * distance;
        const terrain = provider.readHeight(sx, sz);
        if (!terrain.present) {
          missing = true;
          if (options.ray.missingOccludesFog) {
            shaded = true;
            break;
          }
          continue;
        }
        if (terrain.height > rayY + options.ray.terrainHeightBias) {
          shaded = true;
          break;
        }
      }

      values[index] = shaded ? LIGHT_SAMPLE.shaded : missing ? LIGHT_SAMPLE.missing : LIGHT_SAMPLE.lit;
    }
  }

  return {
    key: request.tile,
    sunBin: request.sunBin,
    terrainRevision: request.terrainRevision,
    resolution,
    values,
    builtAtFrame: request.frameIndex,
  };
}
