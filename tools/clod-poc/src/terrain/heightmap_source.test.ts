import { afterEach, describe, expect, it } from "vitest";
import {
  getHeightmapSource,
  sampleHeightmapHeight,
  sampleHeightmapHeightFrom,
  setHeightmapSource,
  type HeightmapSource,
} from "./heightmap_source.js";

function makeSource(overrides: Partial<HeightmapSource> = {}): HeightmapSource {
  return {
    width: 2,
    height: 2,
    data: new Float32Array([0, 1, 1, 0]), // row0: [0,1], row1: [1,0]
    worldCells: 100,
    baseM: 20,
    spanM: 80,
    flipZ: false,
    detailM: 0,
    seed: 0,
    ...overrides,
  };
}

afterEach(() => {
  setHeightmapSource(null);
});

describe("heightmap_source install", () => {
  it("returns null when no source is installed", () => {
    expect(getHeightmapSource()).toBeNull();
    expect(sampleHeightmapHeight(0, 0)).toBeNull();
  });

  it("returns a height once installed", () => {
    setHeightmapSource(makeSource());
    expect(sampleHeightmapHeight(0, 0)).not.toBeNull();
  });
});

describe("heightmap_source vertical mapping", () => {
  it("maps luminance through baseM + luminance*spanM", () => {
    const src = makeSource({ width: 1, height: 1, data: new Float32Array([0.5]), baseM: 10, spanM: 80 });
    // 1x1 raster: every position samples the single texel.
    expect(sampleHeightmapHeightFrom(src, 25, 75)).toBeCloseTo(10 + 0.5 * 80, 6);
  });

  it("clamps below bedrock and above the ceiling", () => {
    const floorSrc = makeSource({ width: 1, height: 1, data: new Float32Array([0]), baseM: -50, spanM: 0 });
    expect(sampleHeightmapHeightFrom(floorSrc, 0, 0)).toBe(1);
    const ceilSrc = makeSource({ width: 1, height: 1, data: new Float32Array([1]), baseM: 0, spanM: 1000 });
    expect(sampleHeightmapHeightFrom(ceilSrc, 0, 0)).toBe(117.5);
  });
});

describe("heightmap_source spatial mapping", () => {
  it("samples the four corners of the raster at the world-domain corners", () => {
    const src = makeSource(); // data row0:[0,1] row1:[1,0], baseM 20 span 80
    // (0,0) -> texel(0,0)=0 -> 20 ; (worldCells,0) -> texel(1,0)=1 -> 100
    expect(sampleHeightmapHeightFrom(src, 0, 0)).toBeCloseTo(20, 6);
    expect(sampleHeightmapHeightFrom(src, 100, 0)).toBeCloseTo(100, 6);
    // (0,worldCells) -> texel(0,1)=1 -> 100 ; (worldCells,worldCells) -> texel(1,1)=0 -> 20
    expect(sampleHeightmapHeightFrom(src, 0, 100)).toBeCloseTo(100, 6);
    expect(sampleHeightmapHeightFrom(src, 100, 100)).toBeCloseTo(20, 6);
  });

  it("bilinearly interpolates the raster centre", () => {
    const src = makeSource();
    // centre of [0,1;1,0] is 0.5 -> 20 + 0.5*80 = 60
    expect(sampleHeightmapHeightFrom(src, 50, 50)).toBeCloseTo(60, 6);
  });

  it("clamps world coordinates outside the domain to the edge texel", () => {
    const src = makeSource();
    expect(sampleHeightmapHeightFrom(src, -500, 0)).toBeCloseTo(sampleHeightmapHeightFrom(src, 0, 0), 6);
    expect(sampleHeightmapHeightFrom(src, 999, 0)).toBeCloseTo(sampleHeightmapHeightFrom(src, 100, 0), 6);
  });

  it("flips the z axis when flipZ is set", () => {
    const noFlip = makeSource({ flipZ: false });
    const flip = makeSource({ flipZ: true });
    // At z=0, flipZ should read the bottom row instead of the top row.
    expect(sampleHeightmapHeightFrom(noFlip, 0, 0)).toBeCloseTo(20, 6); // top row texel = 0 -> 20
    expect(sampleHeightmapHeightFrom(flip, 0, 0)).toBeCloseTo(100, 6); // bottom row texel = 1 -> 100
  });
});
