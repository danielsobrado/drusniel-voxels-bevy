import { describe, expect, it } from "vitest";
import type { WorldViewportPreview } from "../../types/world";
import { buildIsoSurfaceCellPolygons, buildIsoVoxelFacePolygons, collectSamples } from "./LiteVoxelViewport";

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

  it("projects sampled voxel side faces from world-space bottom corners", () => {
    const sample = { x: 8, z: 12, height: 18, material: "TopSoil" as const, water: false };
    const polygons = buildIsoSurfaceCellPolygons(sample, 1, {
      zoom: 2,
      offsetX: 40,
      offsetY: 60,
      rotation: 0,
      pitch: 0.5,
      heightOffset: 0,
    });

    const topSouth = polygons.top[2];
    const topEast = polygons.top[1];
    const bottomSouth = polygons.leftSide[2];

    expect(bottomSouth.x).toBeCloseTo(topSouth.x);
    expect(bottomSouth.y - topSouth.y).toBeCloseTo(2.7);
    expect(Math.abs(topSouth.x - topEast.x)).toBeCloseTo(1.44);
    expect(Math.abs(topSouth.y - topEast.y)).toBeCloseTo(0.72);
    expect(polygons.leftSide[1]).toEqual(topSouth);
    expect(polygons.rightSide[1]).toEqual(topSouth);
  });

  it("projects exact exposed voxel faces as one world-unit cube", () => {
    const faces = buildIsoVoxelFacePolygons(
      { position: [8, 12, 4], material: "TopSoil", water: false, exposedFaces: ["posY", "posX", "negX"] },
      {
        zoom: 2,
        offsetX: 40,
        offsetY: 60,
        rotation: 0,
        pitch: 0.5,
        heightOffset: 0,
      },
    );

    const top = faces.find((face) => face.face === "posY");
    const side = faces.find((face) => face.face === "posX");

    expect(top?.points).toHaveLength(4);
    expect(side?.points).toHaveLength(4);
    expect(Math.abs((top?.points[1].x ?? 0) - (top?.points[0].x ?? 0))).toBeCloseTo(1.44);
    expect(Math.abs((side?.points[2].y ?? 0) - (side?.points[1].y ?? 0))).toBeCloseTo(2.7);
    expect(faces.some((face) => face.face === "negX")).toBe(false);
  });
});
