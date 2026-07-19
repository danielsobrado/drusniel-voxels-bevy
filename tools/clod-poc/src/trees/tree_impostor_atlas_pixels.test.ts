import { describe, expect, it } from "vitest";
import { createTreeImpostorDataTexture } from "./tree_impostor_atlas_readback.js";
import {
  copyTreeImpostorPixels,
  createTreeImpostorAtlasDilationJob,
  createTreeImpostorRowFlipJob,
  dilateTreeImpostorAtlasTiles,
  flipTreeImpostorPixelRows,
  treeImpostorPixelLayoutFor,
  viewTreeImpostorPixels,
} from "./tree_impostor_atlas_pixels.js";
import {
  buildTreeImpostorAlbedoMipmaps,
  buildTreeImpostorNormalDepthMipmaps,
  TREE_IMPOSTOR_MIP_ALPHA_TEST,
} from "./tree_impostor_mipmaps.js";

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
    const albedoLayout = treeImpostorPixelLayoutFor(albedo);
    const normalDepthLayout = treeImpostorPixelLayoutFor(normalDepth);
    expect(albedoLayout).toMatchObject({
      tileSize,
      channel: "albedo",
      coveragePixels: albedo,
    });
    expect(normalDepthLayout).toMatchObject({
      tileSize,
      channel: "normal-depth",
      coveragePixels: albedo,
    });
    expect(albedoLayout?.mipmaps).toHaveLength(1);
    expect(normalDepthLayout?.mipmaps).toHaveLength(1);
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

  it("builds tile-isolated coverage-preserving albedo mipmaps", () => {
    const width = 8;
    const height = 4;
    const tileSize = 4;
    const albedo = new Uint8Array(width * height * 4);
    setPixel(albedo, width, 3, 1, [255, 0, 0, 255]);
    setPixel(albedo, width, 4, 1, [0, 0, 255, 255]);

    const mipmaps = buildTreeImpostorAlbedoMipmaps({ pixels: albedo, width, height, tileSize });
    const first = mipmaps[0];
    expect(mipmaps.map(({ width: mipWidth, height: mipHeight }) => [mipWidth, mipHeight])).toEqual([
      [4, 2],
      [2, 1],
    ]);
    expect(first).toBeDefined();
    if (!first) return;

    const alphaThreshold = Math.round(TREE_IMPOSTOR_MIP_ALPHA_TEST * 255);
    const red = pixel(first.data, first.width, 1, 0);
    const blue = pixel(first.data, first.width, 2, 0);
    expect(red[0]).toBeGreaterThan(0);
    expect(red[2]).toBe(0);
    expect(red[3]).toBeGreaterThan(alphaThreshold);
    expect(blue[0]).toBe(0);
    expect(blue[2]).toBeGreaterThan(0);
    expect(blue[3]).toBeGreaterThan(alphaThreshold);

    for (let x = 0; x < first.width / 2; x++) {
      expect(pixel(first.data, first.width, x, 0)[2]).toBe(0);
    }
    for (let x = first.width / 2; x < first.width; x++) {
      expect(pixel(first.data, first.width, x, 0)[0]).toBe(0);
    }
  });

  it("renormalizes normal-depth mipmaps without cross-tile blending", () => {
    const width = 8;
    const height = 4;
    const tileSize = 4;
    const coverage = new Uint8Array(width * height * 4);
    const normalDepth = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        setPixel(coverage, width, x, y, [255, 255, 255, 255]);
        setPixel(
          normalDepth,
          width,
          x,
          y,
          x < tileSize ? [255, 128, 128, 100] : [0, 128, 128, 200],
        );
      }
    }

    const coverageMipmaps = buildTreeImpostorAlbedoMipmaps({
      pixels: coverage,
      width,
      height,
      tileSize,
    });
    const mipmaps = buildTreeImpostorNormalDepthMipmaps({
      pixels: normalDepth,
      coveragePixels: coverage,
      coverageMipmaps,
      width,
      height,
      tileSize,
    });
    const first = mipmaps[0];
    expect(first).toBeDefined();
    if (!first) return;

    const left = pixel(first.data, first.width, 0, 0);
    const right = pixel(first.data, first.width, first.width - 1, 0);
    expect(left[0]).toBeGreaterThan(240);
    expect(right[0]).toBeLessThan(15);
    expect(left[3]).toBe(100);
    expect(right[3]).toBe(200);
  });

  it("publishes a complete manual DataTexture mip chain", () => {
    const width = 4;
    const height = 4;
    const tileSize = 4;
    const albedo = new Uint8Array(width * height * 4);
    const normalDepth = new Uint8Array(width * height * 4);
    setPixel(albedo, width, 1, 1, [200, 120, 60, 255]);
    setPixel(normalDepth, width, 1, 1, [128, 255, 128, 90]);
    dilateTreeImpostorAtlasTiles({ albedo, normalDepth, width, height, tileSize });

    const texture = createTreeImpostorDataTexture(albedo, width, height, "tree-impostor-test");
    try {
      expect(texture.generateMipmaps).toBe(false);
      expect(texture.mipmaps).toHaveLength(3);
      expect(texture.mipmaps[0]).toMatchObject({ data: albedo, width: 4, height: 4 });
      expect(texture.mipmaps[1]).toMatchObject({ width: 2, height: 2 });
      expect(texture.mipmaps[2]).toMatchObject({ width: 1, height: 1 });
    } finally {
      texture.dispose();
    }
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
    expect(treeImpostorPixelLayoutFor(steppedAlbedo)?.mipmaps).toEqual(
      treeImpostorPixelLayoutFor(synchronousAlbedo)?.mipmaps,
    );
    expect(treeImpostorPixelLayoutFor(steppedNormalDepth)?.mipmaps).toEqual(
      treeImpostorPixelLayoutFor(synchronousNormalDepth)?.mipmaps,
    );
    expect(job.completed()).toBe(job.total());
  });

  it("batches dilation work while keeping row copies narrowly bounded", () => {
    const tileSize = 8;
    const albedo = new Uint8Array(tileSize * tileSize * 4);
    const normalDepth = new Uint8Array(tileSize * tileSize * 4);
    setPixel(albedo, tileSize, 4, 4, [180, 100, 40, 255]);
    setPixel(normalDepth, tileSize, 4, 4, [128, 255, 128, 90]);

    const dilation = createTreeImpostorAtlasDilationJob({
      albedo,
      normalDepth,
      width: tileSize,
      height: tileSize,
      tileSize,
    });
    expect(dilation.step(4096)).toBe(false);
    expect(dilation.step(4096)).toBe(true);

    const rowFlip = createTreeImpostorRowFlipJob(new Uint8Array(128 * 4), 1, 128);
    expect(rowFlip.step(4096)).toBe(false);
    expect(rowFlip.completed()).toBe(16);
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
