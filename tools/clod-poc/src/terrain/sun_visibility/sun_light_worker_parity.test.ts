import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { surfaceHeightCore } from "../../gpu/terrain_field_core.js";
import { createSunLightHeightSampler } from "./far_light_height.js";
import { buildLightTile } from "./light_builder.js";
import { SUN_LIGHT_DEFAULTS, type SunLightOptions } from "./sun_light_options.js";
import { toSunBin } from "./sun_bins.js";
import { buildSunLightWorkerTiles, sunLightWorkerStateFromConfigure } from "./sun_light_worker_build.js";

const OPTIONS: SunLightOptions = {
  ...SUN_LIGHT_DEFAULTS,
  tile: { sizeWorld: 64, resolution: 8 },
  ray: { ...SUN_LIGHT_DEFAULTS.ray, maxDistanceWorld: 256, stepWorld: 8 },
};

function syntheticSummary(res: number, worldSize: number) {
  const heightMax = new Float32Array(res * res);
  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      heightMax[z * res + x] = 12 + Math.sin(x * 0.7) * 9 + Math.cos(z * 0.4) * 7;
    }
  }
  return { res, worldSize, heightMax };
}

describe("sun light worker parity", () => {
  it("worker-built tiles match main-thread tiles bit for bit", () => {
    const summary = syntheticSummary(32, 512);
    const sunVec = { x: 0.42, y: 0.55, z: -0.72 };
    const sunBin = toSunBin(new THREE.Vector3(sunVec.x, sunVec.y, sunVec.z), OPTIONS.directionBins);

    // Main-thread path: provider-style sampler over the live arrays.
    const mainHeightAt = createSunLightHeightSampler(
      summary.res,
      summary.worldSize,
      summary.heightMax,
      (x, z) => surfaceHeightCore(x, z),
    );
    const tiles = [
      { tileX: 0, tileZ: 0, lod: 0 },
      { tileX: 3, tileZ: -2, lod: 0 },
      { tileX: -9, tileZ: 14, lod: 0 },
    ];
    const mainBuilt = tiles.map((tile) => buildLightTile(
      { tile, sunVec, sunBin, terrainRevision: 7, frameIndex: 11 },
      { heightAt: mainHeightAt },
      OPTIONS,
    ));

    // Worker path: state reconstructed from the configure payload (heightMax copy).
    const state = sunLightWorkerStateFromConfigure({
      type: "configure",
      configId: 1,
      terrainFieldConfig: null,
      summary: { ...summary, heightMax: summary.heightMax.slice() },
      options: OPTIONS,
    });
    const workerBuilt = buildSunLightWorkerTiles(state, tiles.map((tile, index) => ({
      key: `k${index}`,
      tileX: tile.tileX,
      tileZ: tile.tileZ,
      lod: tile.lod,
      sunVec: [sunVec.x, sunVec.y, sunVec.z],
      sunBin,
      terrainRevision: 7,
      frameIndex: 11,
    })));

    for (let i = 0; i < tiles.length; i++) {
      expect(workerBuilt[i]!.resolution).toBe(mainBuilt[i]!.resolution);
      expect(Array.from(workerBuilt[i]!.values)).toEqual(Array.from(mainBuilt[i]!.values));
    }
    // Sanity: the tile is not trivially uniform (the parity assertion must bite).
    const distinct = new Set(mainBuilt.flatMap((tile) => Array.from(tile.values)));
    expect(distinct.size).toBeGreaterThan(1);
  });
});
