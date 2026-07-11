import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./terrain_node_material.ts", import.meta.url)),
  "utf8",
);

describe("terrain node biome height blend contract", () => {
  it("uses selected layer ranges instead of fixed global elevation thresholds", () => {
    expect(source).toContain("function layerHeightBandWeight");
    expect(source).toContain("layerHeightMin(layer, slots)");
    expect(source).toContain("layerHeightMax(layer, slots)");
    expect(source).not.toContain("smoothstep(18.0, 34.0, worldPos.y)");
    expect(source).not.toContain("smoothstep(78.0, 112.0, worldPos.y)");
  });

  it("uses the same configured blend width for albedo and normals", () => {
    expect(source).toContain("biomeId, uBlendWidth, useTriplanar");
    expect(source).toContain("biomeId, uBlendWidth, uNormalIntensity");
  });

  it("documents the absolute page coordinate contract", () => {
    expect(source).toContain("CLOD page vertices are stored in absolute world coordinates");
    expect(source).toContain("material.positionNode = worldPos");
  });
});
