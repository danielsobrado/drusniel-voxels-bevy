import { describe, expect, it } from "vitest";
import {
  copyTreeImpostorPixels,
  createTreeImpostorAtlasDilationJob,
  createTreeImpostorRowFlipJob,
  dilateTreeImpostorAtlasTiles,
  flipTreeImpostorPixelRows,
  viewTreeImpostorPixels,
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
  it("dilates normal-depth while preserving premultiplied albedo and coverage", () => {
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

    expect(pixel(albedo, width, 0, 0)).toEqual([120, 80, 40, 255]);
    expect(pixel(albedo, width, 1, 1)).toEqual([0, 0, 0, 0]);
    expect(pixel(normalDepth, width, 1, 1)).toEqual([128, 255, 128, 96]);
    expect(pixel(albedo, width, 2, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(normalDepth, width, 2, 0)).toEqual([255, 128, 128, 180]);
  });

  it("never bleeds normal-depth data across tile boundaries", () => {
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

    expect(pixel(albedo, width, 0, 1)).toEqual([0, 0, 0, 0]);
    expect(pixel(albedo, width, 3, 1)).toEqual([0, 0, 0, 0]);
    expect(pixel(normalDepth, width, 0, 1)).toEqual([10, 20, 30, 40]);
    expect(pixel(normalDepth, width, 3, 1)).toEqual([50, 60, 70, 80]);
  });

  it("produces identical cleanup when stepped one operation at a time", () => {
    const width = 8;
    const height = 4;
    const tileSize = 4;
    const sourceAlbedo = new Uint8Array(width * height * 4);
    const sourceNormalDepth = new Uint8Array(width * height * 4);
    setPixel(sourceAlbedo, width, 1, 1, [180, 100, 40, 255]);
    setPixel(sourceNormalDepth, width, 1, 1, [128, 255, 128, 90]);
    setPixel(sourceAlbedo, width, 6, 2, [20, 90, 170, 255]);
    setPixel(sourceNormalDepth, width, 6, 2, [255, 128, 128, 180]);

    const synchronousAlbedo = sourceAlbedo.slice();
    const synchronousNormalDepth = sourceNormalDepth.slice();
    dilateTreeImpostorAtlasTiles({
      albedo: synchronousAlbedo,
      normalDepth: synchronousNormalDepth,
      width,
      height,
      tileSize,
    });

    const steppedAlbedo = sourceAlbedo.slice();
    const steppedNormalDepth = sourceNormalDepth.slice();
    const job = createTreeImpostorAtlasDilationJob({
      albedo: steppedAlbedo,
      normalDepth: steppedNormalDepth,
      width,
      height,
      tileSize,
    });
    while (!job.step(1)) {
      // Exercise every resumable boundary.
    }

    expect(steppedAlbedo).toEqual(synchronousAlbedo);
    expect(steppedNormalDepth).toEqual(synchronousNormalDepth);
    expect(job.completed()).toBe(job.total());
  });

  it("flips rows incrementally and validates readback lengths", () => {
    const source = new Uint8Array([
      1, 2, 3, 4,
      5, 6, 7, 8,
      9, 10, 11, 12,
      13, 14, 15, 16,
    ]);
    const synchronous = source.slice();
    flipTreeImpostorPixelRows(synchronous, 1, 4);

    const stepped = source.slice();
    const job = createTreeImpostorRowFlipJob(stepped, 1, 4);
    expect(job.step(1)).toBe(false);
    expect(job.step(1)).toBe(true);
    expect(stepped).toEqual(synchronous);
    expect(copyTreeImpostorPixels(stepped, 16)).not.toBe(stepped);
    expect(() => copyTreeImpostorPixels(stepped, 4)).toThrow(/expected 4/);
  });

  it("flips each impostor layer without reversing layer order", () => {
    const pixels = new Uint8Array(4 * 4);
    pixels.set([1, 0, 0, 0], 0);
    pixels.set([2, 0, 0, 0], 4);
    pixels.set([3, 0, 0, 0], 8);
    pixels.set([4, 0, 0, 0], 12);
    const job = createTreeImpostorRowFlipJob(pixels, 1, 4, 2);
    while (!job.step(1)) {
      // Exercise the layer boundary.
    }
    expect([pixels[0], pixels[4], pixels[8], pixels[12]]).toEqual([2, 1, 4, 3]);
  });

  it("retains the asynchronous readback buffer without cloning it", () => {
    const raw = new Uint8Array([1, 2, 3, 4]);
    const view = viewTreeImpostorPixels(raw, raw.length);
    expect(view.buffer).toBe(raw.buffer);
    expect(view.byteOffset).toBe(raw.byteOffset);
    expect(() => viewTreeImpostorPixels(raw, 3)).toThrow(/expected 3/);
  });
});
