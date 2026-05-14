import { describe, expect, it } from "vitest";
import type { WorldViewportPreview } from "../../types/world";
import { collectSamples } from "./LiteVoxelViewport";

describe("collectSamples", () => {
  it("keeps the highest non-air surface per sampled world column", () => {
    const worldViewport: WorldViewportPreview = {
      chunkSize: 16,
      sampleResolution: 4,
      chunks: [
        {
          chunkId: "chunk-0-0-0",
          coordinate: [0, 0, 0],
          samples: [
            { x: 8, z: 8, height: 0, material: "Air", water: false },
            { x: 12, z: 8, height: 6, material: "Rock", water: false },
          ],
        },
        {
          chunkId: "chunk-0-1-0",
          coordinate: [0, 1, 0],
          samples: [
            { x: 8, z: 8, height: 18, material: "TopSoil", water: false },
            { x: 12, z: 8, height: 2, material: "Air", water: false },
          ],
        },
        {
          chunkId: "chunk-0-2-0",
          coordinate: [0, 2, 0],
          samples: [
            { x: 8, z: 8, height: 12, material: "Rock", water: false },
            { x: 16, z: 8, height: 9, material: "Water", water: true },
          ],
        },
      ],
    };

    expect(collectSamples([], worldViewport)).toEqual([
      { x: 12, z: 8, height: 6, material: "Rock", water: false },
      { x: 8, z: 8, height: 18, material: "TopSoil", water: false },
      { x: 16, z: 8, height: 9, material: "Water", water: true },
    ]);
  });
});
