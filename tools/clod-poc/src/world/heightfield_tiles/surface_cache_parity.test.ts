import { describe, expect, it } from "vitest";
import { buildHeightfieldTile } from "./heightfield_tile.js";
import { measureSurfaceCacheParity } from "./surface_cache_parity.js";

describe("measureSurfaceCacheParity", () => {
  const source = { sampleHeight: (x: number, z: number) => x * 0.25 + z * 0.5 };
  const tile = buildHeightfieldTile({ x: 0, z: 0 }, source);

  it("reports resident and fallback agreement", () => {
    const parity = measureSurfaceCacheParity([tile], source, 8, 1);

    expect(parity.samples).toBe(8);
    expect(parity.maxErrorM).toBeLessThanOrEqual(0.001);
  });

  it("detects a divergent fallback path", () => {
    const parity = measureSurfaceCacheParity(
      [tile],
      { sampleHeight: (x, z) => source.sampleHeight(x, z) + 2 },
      8,
      1,
    );

    expect(parity.maxErrorM).toBeCloseTo(2, 5);
  });
});
