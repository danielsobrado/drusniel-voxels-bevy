import { describe, expect, it } from "vitest";
import { SAVE_REGION_SIZE_M } from "../save_config.js";
import { boundsForRegion, regionKeysForBounds } from "./metadata_store.js";

describe("world metadata region bounds", () => {
  it("maps positive half-open bounds to the touched region only", () => {
    expect(regionKeysForBounds({
      minX: 0,
      minZ: 0,
      maxX: SAVE_REGION_SIZE_M,
      maxZ: SAVE_REGION_SIZE_M,
    })).toEqual(["r_0_0"]);
  });

  it("maps exact positive boundary points to the actual region", () => {
    expect(regionKeysForBounds({
      minX: SAVE_REGION_SIZE_M,
      minZ: 0,
      maxX: SAVE_REGION_SIZE_M,
      maxZ: 0,
    })).toEqual(["r_1_0"]);
  });

  it("maps negative half-open bounds to the negative region only", () => {
    expect(regionKeysForBounds({
      minX: -SAVE_REGION_SIZE_M,
      minZ: 0,
      maxX: 0,
      maxZ: SAVE_REGION_SIZE_M,
    })).toEqual(["r_-1_0"]);
  });

  it("maps exact negative boundary points to the actual negative region", () => {
    expect(regionKeysForBounds({
      minX: -SAVE_REGION_SIZE_M,
      minZ: 0,
      maxX: -SAVE_REGION_SIZE_M,
      maxZ: 0,
    })).toEqual(["r_-1_0"]);
  });

  it("returns save region footprints as matching half-open bounds", () => {
    expect(boundsForRegion("r_-1_2")).toEqual({
      minX: -SAVE_REGION_SIZE_M,
      minZ: 2 * SAVE_REGION_SIZE_M,
      maxX: 0,
      maxZ: 3 * SAVE_REGION_SIZE_M,
    });
  });
});
