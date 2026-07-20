import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("traced gravel-bed terrain authority wiring", () => {
  it("routes the shared traced carver through the runtime gravel-bed resolver", () => {
    const source = readFileSync(new URL("./infinite_hydrology.ts", import.meta.url), "utf8");

    expect(source).toContain("createRuntimeGravelBedTerrainResolver");
    expect(source).toContain("const applyGravelBed = createRuntimeGravelBedTerrainResolver(sampler)");
    expect(source).toContain("sampleInfiniteHydrologyAtBaseHeight(x, z, baseHeight, sampler, { carve: config })");
    expect(source).toContain(").terrainY");
  });
});
