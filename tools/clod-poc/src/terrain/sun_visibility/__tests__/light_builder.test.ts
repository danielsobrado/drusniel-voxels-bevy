import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildLightTile, LIGHT_SAMPLE } from "../light_builder.js";
import { parseSunLightOptions } from "../sun_light_options.js";

function provider(heightFn: (x: number, z: number) => { height: number; present: boolean; revision?: number }) {
  return {
    readHeight: (x: number, z: number) => ({ revision: 1, ...heightFn(x, z) }),
    tileRevision: () => 1,
  };
}

const options = parseSunLightOptions({
  tile: { size_world: 32, resolution: 4 },
  ray: { max_distance_world: 64, step_world: 4, receiver_height_bias: 0.75, terrain_height_bias: 0.25, missing_casts_shade: true },
});

const baseRequest = {
  tile: { tileX: 0, tileZ: 0, lod: 0 },
  sunBin: { azimuthIndex: 0, elevationIndex: 1 },
  terrainRevision: 1,
  frameIndex: 1,
};

describe("sun light tile builder", () => {
  it("keeps flat terrain lit", () => {
    const tile = buildLightTile({ ...baseRequest, sunVec: new THREE.Vector3(1, 1, 0) }, provider(() => ({ height: 0, present: true })), options);
    expect([...tile.values].every((value) => value === LIGHT_SAMPLE.lit)).toBe(true);
  });

  it("shades behind a ridge for low sun", () => {
    const tile = buildLightTile({ ...baseRequest, sunVec: new THREE.Vector3(1, 0.15, 0) }, provider((x) => ({ height: x >= 20 && x <= 24 ? 10 : 0, present: true })), options);
    expect([...tile.values].some((value) => value === LIGHT_SAMPLE.shaded)).toBe(true);
  });

  it("does not let the same ridge affect the opposite direction", () => {
    const tile = buildLightTile({ ...baseRequest, sunVec: new THREE.Vector3(-1, 0.15, 0) }, provider((x) => ({ height: x >= 20 && x <= 24 ? 10 : 0, present: true })), options);
    expect(tile.values[0]).toBe(LIGHT_SAMPLE.lit);
  });

  it("marks missing receiver data", () => {
    const tile = buildLightTile({ ...baseRequest, sunVec: new THREE.Vector3(1, 1, 0) }, provider(() => ({ height: 0, present: false })), options);
    expect([...tile.values].every((value) => value === LIGHT_SAMPLE.missing)).toBe(true);
  });
});
