import type { HydrologyGrid } from "./hydrologyGrid.js";

export async function writeHydrologyDebugDump(grid: HydrologyGrid, dumpDir: string): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(dumpDir, { recursive: true });
  await Promise.all([
    writePgm(pathJoin(dumpDir, "wet-mask.pgm"), grid.wetMask, grid.res, grid.res, writeFile),
    writePgm(pathJoin(dumpDir, "lake-mask.pgm"), grid.lakeMask, grid.res, grid.res, writeFile),
    writePgm(pathJoin(dumpDir, "river-mask.pgm"), grid.riverMask, grid.res, grid.res, writeFile),
    writePgm(pathJoin(dumpDir, "water-y.pgm"), grid.waterY, grid.res, grid.res, writeFile),
    writePgm(pathJoin(dumpDir, "water-y-far.pgm"), grid.waterYFar, grid.farRes, grid.farRes, writeFile),
    writePgm(pathJoin(dumpDir, "flow-strength.pgm"), grid.flowStrength, grid.res, grid.res, writeFile),
    writePgm(pathJoin(dumpDir, "river-depth.pgm"), grid.riverDepth, grid.res, grid.res, writeFile),
    writePgm(pathJoin(dumpDir, "moisture.pgm"), grid.moisture, grid.res, grid.res, writeFile),
    writeBodyKindPpm(pathJoin(dumpDir, "body-kind.ppm"), grid, writeFile),
  ]);
}

type WriteFile = (path: string, data: Uint8Array | string) => Promise<void>;

async function writePgm(path: string, field: Float32Array, width: number, height: number, writeFile: WriteFile): Promise<void> {
  const [min, max] = finiteRange(field);
  const scale = max > min ? 255 / (max - min) : 0;
  const body = new Uint8Array(width * height);
  for (let i = 0; i < body.length; i++) {
    const value = Number.isFinite(field[i]) ? field[i] : min;
    body[i] = Math.max(0, Math.min(255, Math.round((value - min) * scale)));
  }
  await writeFile(path, Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`), body]));
}

async function writeBodyKindPpm(path: string, grid: HydrologyGrid, writeFile: WriteFile): Promise<void> {
  const body = new Uint8Array(grid.res * grid.res * 3);
  for (let i = 0; i < grid.bodyKind.length; i++) {
    const [r, g, b] = bodyKindColor(grid.bodyKind[i]);
    body[i * 3] = r;
    body[i * 3 + 1] = g;
    body[i * 3 + 2] = b;
  }
  await writeFile(path, Buffer.concat([Buffer.from(`P6\n${grid.res} ${grid.res}\n255\n`), body]));
}

function pathJoin(dir: string, file: string): string {
  return `${dir.replace(/[\\/]$/, "")}/${file}`;
}

function finiteRange(field: Float32Array): [number, number] {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of field) {
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return Number.isFinite(min) && Number.isFinite(max) ? [min, max] : [0, 1];
}

function bodyKindColor(kind: number): [number, number, number] {
  switch (kind) {
    case 1: return [0, 60, 220];
    case 2: return [40, 180, 255];
    case 3: return [80, 255, 120];
    case 4: return [100, 180, 210];
    case 5: return [120, 140, 80];
    default: return [0, 0, 0];
  }
}
