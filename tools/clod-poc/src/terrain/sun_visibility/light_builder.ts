import * as THREE from "three";
import { sunVisibilityTileBounds, type SunVisibilityTileKey } from "./sun_visibility_tile.js";
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

/** Resumable tile build: one tile is up to resolution² texels × ray steps of
 *  height samples (hundreds of ms), far too much for a single frame. Callers
 *  step the build against a deadline; at least one texel of progress is made
 *  per call so the build always terminates. */
export interface LightTileBuild {
  readonly request: LightTileBuildRequest;
  readonly resolution: number;
  readonly values: Uint8Array;
  cursor: number;
  /** Per-tile constants hoisted out of the texel loop. */
  readonly minX: number;
  readonly minZ: number;
  readonly cellSize: number;
  readonly zeroHorizontal: boolean;
  readonly stepX: number;
  readonly stepZ: number;
  readonly slope: number;
}

export function createLightTileBuild(request: LightTileBuildRequest, options: SunLightOptions): LightTileBuild {
  const resolution = options.tile.resolution;
  const bounds = sunVisibilityTileBounds(request.tile, options.tile);
  const sun = request.sunVec.clone().normalize();
  const horizontalLength = Math.hypot(sun.x, sun.z);
  const zeroHorizontal = horizontalLength < 0.001;
  return {
    request,
    resolution,
    values: new Uint8Array(resolution * resolution),
    cursor: 0,
    minX: bounds.minX,
    minZ: bounds.minZ,
    cellSize: options.tile.sizeWorld / resolution,
    zeroHorizontal,
    stepX: zeroHorizontal ? 0 : sun.x / horizontalLength,
    stepZ: zeroHorizontal ? 0 : sun.z / horizontalLength,
    slope: sun.y / Math.max(horizontalLength, 0.001),
  };
}

export function stepLightTileBuild(
  build: LightTileBuild,
  provider: ReturnType<typeof createTerrainSummaryLightHeightProvider>,
  options: SunLightOptions,
  deadlineMs: number,
): boolean {
  const resolution = build.resolution;
  const total = resolution * resolution;
  const heightAt = provider.heightAt;
  const values = build.values;
  const stepWorld = options.ray.stepWorld;
  const maxDistanceWorld = options.ray.maxDistanceWorld;
  const receiverHeightBias = options.ray.receiverHeightBias;
  const terrainHeightBias = options.ray.terrainHeightBias;
  const missingOccludesFog = options.ray.missingOccludesFog;

  while (build.cursor < total) {
    const index = build.cursor;
    const cellX = index % resolution;
    const cellZ = (index / resolution) | 0;
    const receiverX = build.minX + (cellX + 0.5) * build.cellSize;
    const receiverZ = build.minZ + (cellZ + 0.5) * build.cellSize;
    const receiverHeight = heightAt(receiverX, receiverZ);

    if (Number.isNaN(receiverHeight)) {
      values[index] = LIGHT_SAMPLE.missing;
    } else if (build.zeroHorizontal) {
      values[index] = LIGHT_SAMPLE.lit;
    } else {
      const originY = receiverHeight + receiverHeightBias;
      let shaded = false;
      let missing = false;
      for (let distance = stepWorld; distance <= maxDistanceWorld; distance += stepWorld) {
        const terrain = heightAt(receiverX + build.stepX * distance, receiverZ + build.stepZ * distance);
        if (Number.isNaN(terrain)) {
          missing = true;
          if (missingOccludesFog) {
            shaded = true;
            break;
          }
          continue;
        }
        if (terrain > originY + build.slope * distance + terrainHeightBias) {
          shaded = true;
          break;
        }
      }
      values[index] = shaded ? LIGHT_SAMPLE.shaded : missing ? LIGHT_SAMPLE.missing : LIGHT_SAMPLE.lit;
    }

    build.cursor++;
    if (performance.now() >= deadlineMs) break;
  }
  return build.cursor >= total;
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
  provider: ReturnType<typeof createTerrainSummaryLightHeightProvider>,
  options: SunLightOptions,
): LightTile {
  const build = createLightTileBuild(request, options);
  stepLightTileBuild(build, provider, options, Number.POSITIVE_INFINITY);
  return finalizeLightTile(build);
}
