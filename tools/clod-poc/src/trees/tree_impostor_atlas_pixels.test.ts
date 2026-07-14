import { describe, expect, it } from "vitest";
import {
  copyTreeImpostorPixels,
  dilateTreeImpostorAtlasTiles,
  flipTreeImpostorPixelRows,
} from "./tree_impostor_atlas_pixels.js";

const pixelOffset = (width: number, x: number, y: number): number => (y * width + x) * 4;

function setPixel(
  pixels: Uint8Array,
  width: number,
  x: number,
  y: number,
  rgba: readonly [number, number, number, number],
): void {
  pixels.set(rgba, pixelOffset(width, x, y));
}

function pixel(pixels: Uint8Array, width: number, x: number, y: number): number[] {
  const offset = pixelOffset(width, x, y);
  return Array.from(pixels.subarray(offset, offset + 4));
}

describe("tree impostor atlas pixels", () => {
  it("dilates RGB and normal-depth within each tile without changing coverage", () => {
    const width = 4;
    const height = 2;
    const tileSize = 2;
    const albedo = new Uint8Array(width * height * 4);
    const normalDepth = new Uint8Array(width * height * 4);

    setPixel(albedo, width, 0, 0, [120, 80, 40, 255]);
    setPixel(normalDepth, width, 0, 0, [128, 255, 128, 96]);
    setPixel(albedo, width, 3, 1, [20, 60, 100, 255]);
    setPixel(normalDepth, width, 3, 1, [255, 128, 128, 180]);

    dilateTreeImpostorAtlasTiles({ albedo, normalDepth, width, height, tileSize });

    expect(pixel(albedo, width, 1, 1)).toEqual([120, 80, 40, 0]);
    expect(pixel(normalDepth, width, 1, 1)).toEqual([128, 255, 128, 96]);
    expect(pixel(albedo, width, 2, 0)).toEqual([20, 60, 100, 0]);
    expect(pixel(normalDepth, width, 2, 0)).toEqual([255, 128, 128, 180]);
  });

  it("never bleeds colours across tile boundaries", () => {
    const width = 4;
    const height = 2;
    const tileSize = 2;
    const albedo = new Uint8Array(width * height * 4);
    const normalDepth = new Uint8Array(width * height * 4);

    setPixel(albedo, width, 1, 0, [240, 10, 10, 255]);
    setPixel(normalDepth, width, 1, 0, [10, 20, 30, 40]);
    setPixel(albedo, width, 2, 0, [10, 10, 240, 255]);
    setPixel(normalDepth, width, 2, 0, [50, 60, 70, 80]);

    dilateTreeImpostorAtlasTiles({ albedo, normalDepth, width, height, tileSize });

    expect(pixel(albedo, width, 0, 1)).toEqual([240, 10, 10, 0]);
    expect(pixel(albedo, width, 3, 1)).toEqual([10, 10, 240, 0]);
  });

  it("flips rows and validates readback lengths", () => {
    const pixels = new Uint8Array([
      1, 2, 3, 4,
      5, 6, 7, 8,
    ]);
    flipTreeImpostorPixelRows(pixels, 1, 2);
    expect(Array.from(pixels)).toEqual([
      5, 6, 7, 8,
      1, 2, 3, 4,
    ]);
    expect(copyTreeImpostorPixels(pixels, 8)).not.toBe(pixels);
    expect(() => copyTreeImpostorPixels(pixels, 4)).toThrow(/expected 4/);
  });
});
