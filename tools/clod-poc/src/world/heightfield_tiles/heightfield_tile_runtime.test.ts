import { describe, expect, it } from "vitest";
import type { CreateHeightfieldTileRuntimeInput } from "./heightfield_tile_runtime.js";
import { gpuAtlasIsAuthoritative } from "./heightfield_tile_runtime.js";

function makeInput(
  worldMode: string,
  hydrologyGraph: object | null,
): CreateHeightfieldTileRuntimeInput {
  return {
    terrainSource: {
      worldMode,
      worldManifest: { artifacts: { hydrologyGraph } } as never,
    },
  } as unknown as CreateHeightfieldTileRuntimeInput;
}

describe("gpuAtlasIsAuthoritative", () => {
  it("treats infinite_islands as authoritative without a hydrology graph", () => {
    expect(gpuAtlasIsAuthoritative(makeInput("infinite_islands", null))).toBe(true);
  });

  it("treats infinite_islands as authoritative even with a hydrology graph", () => {
    expect(gpuAtlasIsAuthoritative(makeInput("infinite_islands", { id: "h", hash: "h" }))).toBe(true);
  });

  it("requires a hydrology graph for continent mode", () => {
    expect(gpuAtlasIsAuthoritative(makeInput("continent", null))).toBe(false);
    expect(gpuAtlasIsAuthoritative(makeInput("continent", { id: "h", hash: "h" }))).toBe(true);
  });

  it("is not authoritative for finite or unknown modes", () => {
    expect(gpuAtlasIsAuthoritative(makeInput("finite", null))).toBe(false);
    expect(gpuAtlasIsAuthoritative(makeInput("finite", { id: "h", hash: "h" }))).toBe(false);
  });
});