import { describe, expect, it } from "vitest";
import { regionKeysForBounds } from "../world_metadata/metadata_store.js";

describe("regionKeysForBounds", () => {
  it("maps exact positive area boundary as half-open", () => {
    expect(regionKeysForBounds({ minX: 0, minZ: 0, maxX: 512, maxZ: 512 })).toEqual(["r_0_0"]);
  });

  it("maps exact point bounds normally", () => {
    expect(regionKeysForBounds({ minX: 512, minZ: 0, maxX: 512, maxZ: 0 })).toEqual(["r_1_0"]);
  });

  it("maps exact negative area boundary as half-open", () => {
    expect(regionKeysForBounds({ minX: -512, minZ: -512, maxX: 0, maxZ: 0 })).toEqual(["r_-1_-1"]);
  });

  it("maps small area across the origin to four regions", () => {
    expect(regionKeysForBounds({ minX: -0.5, minZ: -0.5, maxX: 0.5, maxZ: 0.5 })).toEqual(["r_-1_-1", "r_-1_0", "r_0_-1", "r_0_0"]);
  });
});
