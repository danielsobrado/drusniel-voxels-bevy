import { describe, expect, it } from "vitest";
import type { WorldViewportPreview } from "../../types/world";
import { collectExposedVoxels, collectSamples, exposedVoxelTransform } from "./voxelGeometry";

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

  it("derives placement samples from exact exposed voxel tops", () => {
    const worldViewport: WorldViewportPreview = {
      chunkSize: 16,
      sampleResolution: 16,
      chunks: [
        {
          chunkId: "chunk-0-0-0",
          coordinate: [0, 0, 0],
          samples: [],
          voxels: [
            { position: [2, 4, 3], material: "Rock", water: false, exposedFaces: ["posY", "posX"] },
            { position: [2, 7, 3], material: "TopSoil", water: false, exposedFaces: ["posY"] },
            { position: [5, 2, 3], material: "Water", water: true, exposedFaces: ["posX"] },
          ],
        },
      ],
    };

    expect(collectSamples([], worldViewport)).toEqual([{ x: 2, z: 3, height: 8, material: "TopSoil", water: false }]);
  });

  it("collects exact exposed voxels and transforms them as one world-unit cube", () => {
    const worldViewport: WorldViewportPreview = {
      chunkSize: 16,
      sampleResolution: 16,
      chunks: [
        {
          chunkId: "chunk-0-0-0",
          coordinate: [0, 0, 0],
          samples: [],
          voxels: [{ position: [8, 12, 4], material: "TopSoil", water: false, exposedFaces: ["posY", "posX", "negX"] }],
        },
      ],
    };

    const [voxel] = collectExposedVoxels(worldViewport);
    const transform = exposedVoxelTransform(voxel);

    expect(transform.position.toArray()).toEqual([8.5, 12.5, 4.5]);
    expect(transform.scale.toArray()).toEqual([1, 1, 1]);
  });
});
