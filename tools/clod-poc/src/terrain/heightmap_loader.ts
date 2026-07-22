// Browser-side decode of a grayscale heightmap image (e.g. an Azgaar Fantasy-Map-Generator
// export) into a HeightmapSource raster. Kept separate from heightmap_source.ts so the sampler
// stays pure and worker-/test-safe; only this module touches fetch/createImageBitmap/canvas.

import type { HeightmapSource } from "./heightmap_source.js";

export interface HeightmapLoadOptions {
  worldCells: number;
  baseM: number;
  spanM: number;
  flipZ: boolean;
  detailM: number;
  seed: number;
}

export async function loadHeightmapSource(url: string, opts: HeightmapLoadOptions): Promise<HeightmapSource> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`heightmap fetch failed: ${res.status} ${res.statusText} (${url})`);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  const width = bitmap.width;
  const height = bitmap.height;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
  if (!ctx) {
    bitmap.close();
    throw new Error("heightmap: 2d canvas context unavailable");
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i++) {
    const o = i * 4;
    // Grayscale heightmaps carry R=G=B; Rec.601 luminance keeps colour exports usable too.
    data[i] = (0.299 * rgba[o]! + 0.587 * rgba[o + 1]! + 0.114 * rgba[o + 2]!) / 255;
  }
  return {
    width,
    height,
    data,
    worldCells: opts.worldCells,
    baseM: opts.baseM,
    spanM: opts.spanM,
    flipZ: opts.flipZ,
    detailM: opts.detailM,
    seed: opts.seed,
  };
}
