import * as THREE from "three";
import { sunVisibilityTileBounds, type SunVisibilityTileKey } from "./sun_visibility_tile.js";
import type { SunDirectionBin } from "./sun_bins.js";
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

export interface LightTileHeightProvider {
  readHeight(x: number, z: number): { height: number; present: boolean };
  /** Optional allocation-free fast path; NaN means "no data". */
  heightAt?: (x: number, z: number) => number;
}

export interface LightTileBuild {
  request: LightTileBuildRequest;
  resolution: number;
  values: Uint8Array;
  /** Next texel index to build; resolution² when finished. */
  nextIndex: number;
  stepX: number;
  stepZ: number;
  slope: number;
  horizontal: number;
  minX: number;
  minZ: number;
  cellSize: number;
}

export function createLightTileBuild(request: LightTileBuildRequest, options: SunLightOptions): LightTileBuild {
  const resolution = options.tile.resolution;
  const bounds = sunVisibilityTileBounds(request.tile, options.tile);
  const len = Math.hypot(request.sunVec.x, request.sunVec.y, request.sunVec.z) || 1;
  const nx = request.sunVec.x / len;
  const ny = request.sunVec.y / len;
  const nz = request.sunVec.z / len;
  const horizontal = Math.hypot(nx, nz);
  return {
    request,
    resolution,
    values: new Uint8Array(resolution * resolution),
    nextIndex: 0,
    horizontal,
    stepX: horizontal > 0 ? nx / horizontal : 0,
    stepZ: horizontal > 0 ? nz / horizontal : 0,
    slope: ny / Math.max(horizontal, 0.001),
    minX: bounds.minX,
    minZ: bounds.minZ,
    cellSize: options.tile.sizeWorld / resolution,
  };
}

/**
 * Builds texels until the tile is complete or `deadlineMs` passes. Always
 * makes at least one texel of progress so a zero budget still drains the
 * queue. Returns true when the tile is finished.
 */
export function stepLightTileBuild(
  build: LightTileBuild,
  provider: LightTileHeightProvider,
  options: SunLightOptions,
  deadlineMs: number,
): boolean {
  const { resolution, values, stepX, stepZ, slope, horizontal, minX, minZ, cellSize } = build;
  const total = resolution * resolution;
  if (build.nextIndex >= total) return true;

  const heightAt = provider.heightAt ?? ((x: number, z: number) => {
    const sample = provider.readHeight(x, z);
    return sample.present ? sample.height : Number.NaN;
  });
  const rayStep = options.ray.stepWorld;
  const rayMax = options.ray.maxDistanceWorld;
  const receiverBias = options.ray.receiverHeightBias;
  const terrainBias = options.ray.terrainHeightBias;
  const missingOccludes = options.ray.missingOccludesFog;

  while (build.nextIndex < total) {
    const index = build.nextIndex;
    const cellX = index % resolution;
    const cellZ = (index / resolution) | 0;
    const rx = minX + (cellX + 0.5) * cellSize;
    const rz = minZ + (cellZ + 0.5) * cellSize;
    const receiverHeight = heightAt(rx, rz);

    let value: number;
    if (Number.isNaN(receiverHeight)) {
      value = LIGHT_SAMPLE.missing;
    } else if (horizontal < 0.001) {
      value = LIGHT_SAMPLE.lit;
    } else {
      const originY = receiverHeight + receiverBias;
      let shaded = false;
      let missing = false;
      for (let distance = rayStep; distance <= rayMax; distance += rayStep) {
        const terrainHeight = heightAt(rx + stepX * distance, rz + stepZ * distance);
        if (Number.isNaN(terrainHeight)) {
          missing = true;
          if (missingOccludes) {
            shaded = true;
            break;
          }
          continue;
        }
        if (terrainHeight > originY + slope * distance + terrainBias) {
          shaded = true;
          break;
        }
      }
      value = shaded ? LIGHT_SAMPLE.shaded : missing ? LIGHT_SAMPLE.missing : LIGHT_SAMPLE.lit;
    }

    values[index] = value;
    build.nextIndex = index + 1;
    if (performance.now() >= deadlineMs) break;
  }
  return build.nextIndex >= total;
}

export function finalizeLightTile(build: LightTileBuild): LightTile {
  return {
    key: build.request.tile,
    sunBin: build.request.sunBin,
    terrainRevision: build.request.terrainRevision,
    resolution: build.resolution,
    values: build.values,
    builtAtFrame: build.request.frameIndex,
  };
}

export function buildLightTile(
  request: LightTileBuildRequest,
  provider: LightTileHeightProvider,
  options: SunLightOptions,
): LightTile {
  const build = createLightTileBuild(request, options);
  stepLightTileBuild(build, provider, options, Number.POSITIVE_INFINITY);
  return finalizeLightTile(build);
}
