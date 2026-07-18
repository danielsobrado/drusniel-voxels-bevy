import { describe, expect, it } from "vitest";
import source from "./stone_node_material.ts?raw";

describe("submerged stone material contract", () => {
  it("decodes the compact underwater flag separately from sink depth", () => {
    expect(source).toContain("instB.w.greaterThanEqual(float(STONE_META_UNDERWATER_FLAG))");
    expect(source).toContain("const sinkDepth: TslNode = instB.w.sub(underwaterOffset);");
  });

  it("keeps streamed cobble height and forces wet visibility", () => {
    expect(source).toContain("groundY = underwater.select(instA.y, sampledGround);");
    expect(source).toContain("aboveWater = underwater.or(dryVisibility);");
    expect(source).toContain("underwater.select(uWetRockDarkening, float(0))");
  });
});
