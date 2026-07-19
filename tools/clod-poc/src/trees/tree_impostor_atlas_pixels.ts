import {
  createTreeImpostorMipJob,
  type TreeImpostorMipLevel,
} from "./tree_impostor_mipmaps.js";

const BYTES_PER_PIXEL = 4;
const COVERAGE_THRESHOLD = 8;
const DEFAULT_DILATION_OPERATIONS = 1024;
const MAX_ROW_FLIP_OPERATIONS = 16;
const MAX_DILATION_OPERATIONS = 4096;

export type TreeImpostorPixelChannel = "albedo" | "normal-depth";

export interface TreeImpostorPixelLayout {
  tileSize: number;
  channel: TreeImpostorPixelChannel;
  coveragePixels: Uint8Array;
  mipmaps: readonly TreeImpostorMipLevel[] | null;
}

export interface TreeImpostorAtlasPixels {
  albedo: Uint8Array;
  normalDepth: Uint8Array;
  width: number;
  height: number;
  tileSize: number;
}

export interface TreeImpostorPixelJob {
  step(maxOperations?: number): boolean;
  completed(): number;
  total(): number;
}

interface TileDilationState {
  originX: number;
  originY: number;
  filled: Uint8Array;
  queued: Uint8Array;
  queue: Int32Array;
  head: number;
  tail: number;
  cursor: number;
  phase: "coverage" | "seed" | "flood";
}

const PIXEL_LAYOUTS = new WeakMap<Uint8Array, TreeImpostorPixelLayout>();

export function treeImpostorPixelLayoutFor(pixels: Uint8Array): TreeImpostorPixelLayout | null {
  return PIXEL_LAYOUTS.get(pixels) ?? null;
}

export function viewTreeImpostorPixels(raw: ArrayBufferView, expectedLength: number): Uint8Array {
  const source = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  if (source.length !== expectedLength) {
    throw new Error(`tree impostor readback returned ${source.length} bytes; expected ${expectedLength}`);
  }
  return source;
}

export function copyTreeImpostorPixels(raw: ArrayBufferView, expectedLength: number): Uint8Array {
  return viewTreeImpostorPixels(raw, expectedLength).slice();
}

export function createTreeImpostorRowFlipJob(
  pixels: Uint8Array,
  width: number,
  height: number,
  pageHeight = height,
): TreeImpostorPixelJob {
  validatePixelBuffer(pixels, width, height, "tree impostor row flip");
  if (!Number.isInteger(pageHeight) || pageHeight <= 0 || height % pageHeight !== 0) {
    throw new Error(`tree impostor row flip page height ${pageHeight} does not divide ${height}`);
  }
  const rowLength = width * BYTES_PER_PIXEL;
  const row = new Uint8Array(rowLength);
  const pairsPerPage = Math.floor(pageHeight / 2);
  const totalRows = pairsPerPage * (height / pageHeight);
  let currentRow = 0;
  return {
    step(maxOperations = 1): boolean {
      const limit = Math.min(MAX_ROW_FLIP_OPERATIONS, Math.max(1, Math.floor(maxOperations)));
      let operations = 0;
      while (currentRow < totalRows && operations < limit) {
        const page = Math.floor(currentRow / pairsPerPage);
        const localRow = currentRow % pairsPerPage;
        const top = (page * pageHeight + localRow) * rowLength;
        const bottom = (page * pageHeight + pageHeight - 1 - localRow) * rowLength;
        row.set(pixels.subarray(top, top + rowLength));
        pixels.copyWithin(top, bottom, bottom + rowLength);
        pixels.set(row, bottom);
        currentRow++;
        operations++;
      }
      return currentRow >= totalRows;
    },
    completed: () => currentRow,
    total: () => totalRows,
  };
}

export function flipTreeImpostorPixelRows(pixels: Uint8Array, width: number, height: number): void {
  const job = createTreeImpostorRowFlipJob(pixels, width, height);
  while (!job.step(Number.MAX_SAFE_INTEGER)) {
    // Synchronous compatibility path.
  }
}

function createTreeImpostorDilationJob(input: TreeImpostorAtlasPixels): TreeImpostorPixelJob {
  const { albedo, normalDepth, width, height, tileSize } = input;
  validatePixelBuffer(albedo, width, height, "tree impostor albedo dilation");
  validatePixelBuffer(normalDepth, width, height, "tree impostor normal-depth dilation");
  if (!Number.isInteger(tileSize) || tileSize <= 0 || width % tileSize !== 0 || height % tileSize !== 0) {
    throw new Error(`tree impostor tile size ${tileSize} does not divide ${width}x${height}`);
  }
  const tilesX = width / tileSize;
  const tilesY = height / tileSize;
  const totalTiles = tilesX * tilesY;
  const pixelCount = tileSize * tileSize;
  const filled = new Uint8Array(pixelCount);
  const queued = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let tileIndex = 0;
  let state: TileDilationState | null = null;

  const localIndex = (x: number, y: number): number => y * tileSize + x;
  const atlasOffset = (originX: number, originY: number, x: number, y: number): number => (
    (originY + y) * width + originX + x
  ) * BYTES_PER_PIXEL;

  const createState = (): TileDilationState => {
    filled.fill(0);
    queued.fill(0);
    return {
      originX: (tileIndex % tilesX) * tileSize,
      originY: Math.floor(tileIndex / tilesX) * tileSize,
      filled,
      queued,
      queue,
      head: 0,
      tail: 0,
      cursor: 0,
      phase: "coverage",
    };
  };

  const hasFilledNeighbour = (current: TileDilationState, x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= tileSize || ny >= tileSize) continue;
        if (current.filled[localIndex(nx, ny)]) return true;
      }
    }
    return false;
  };

  const enqueue = (current: TileDilationState, x: number, y: number): void => {
    const index = localIndex(x, y);
    if (current.filled[index] || current.queued[index] || current.tail >= current.queue.length) return;
    current.queued[index] = 1;
    current.queue[current.tail++] = index;
  };

  const processFloodPixel = (current: TileDilationState): void => {
    if (current.head >= current.tail) {
      tileIndex++;
      state = null;
      return;
    }
    const index = current.queue[current.head++] as number;
    current.queued[index] = 0;
    if (current.filled[index]) return;
    const x = index % tileSize;
    const y = Math.floor(index / tileSize);
    let count = 0;
    let normalR = 0;
    let normalG = 0;
    let normalB = 0;
    let depth = 0;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= tileSize || ny >= tileSize) continue;
        if (!current.filled[localIndex(nx, ny)]) continue;
        const offset = atlasOffset(current.originX, current.originY, nx, ny);
        normalR += normalDepth[offset] as number;
        normalG += normalDepth[offset + 1] as number;
        normalB += normalDepth[offset + 2] as number;
        depth += normalDepth[offset + 3] as number;
        count++;
      }
    }
    if (count === 0) return;

    const target = atlasOffset(current.originX, current.originY, x, y);
    // The albedo channel is decoded as premultiplied by coverage. Zero-alpha
    // texels must therefore retain zero RGB so generated mipmaps remain valid.
    normalDepth[target] = Math.round(normalR / count);
    normalDepth[target + 1] = Math.round(normalG / count);
    normalDepth[target + 2] = Math.round(normalB / count);
    normalDepth[target + 3] = Math.round(depth / count);
    current.filled[index] = 1;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= tileSize || ny >= tileSize) continue;
        enqueue(current, nx, ny);
      }
    }
  };

  return {
    step(maxOperations = DEFAULT_DILATION_OPERATIONS): boolean {
      const limit = Math.min(MAX_DILATION_OPERATIONS, Math.max(1, Math.floor(maxOperations)));
      let operations = 0;
      while (tileIndex < totalTiles && operations < limit) {
        state ??= createState();
        if (state.phase === "coverage") {
          const index = state.cursor;
          const x = index % tileSize;
          const y = Math.floor(index / tileSize);
          const offset = atlasOffset(state.originX, state.originY, x, y);
          state.filled[index] = (albedo[offset + 3] as number) > COVERAGE_THRESHOLD ? 1 : 0;
          state.cursor++;
          if (state.cursor >= pixelCount) {
            state.cursor = 0;
            state.phase = "seed";
          }
        } else if (state.phase === "seed") {
          const index = state.cursor;
          const x = index % tileSize;
          const y = Math.floor(index / tileSize);
          if (!state.filled[index] && hasFilledNeighbour(state, x, y)) enqueue(state, x, y);
          state.cursor++;
          if (state.cursor >= pixelCount) state.phase = "flood";
        } else {
          processFloodPixel(state);
        }
        operations++;
      }
      return tileIndex >= totalTiles;
    },
    completed: () => tileIndex,
    total: () => totalTiles,
  };
}

export function createTreeImpostorAtlasDilationJob(input: TreeImpostorAtlasPixels): TreeImpostorPixelJob {
  const layouts = registerPixelLayouts(input.albedo, input.normalDepth, input.tileSize);
  const dilation = createTreeImpostorDilationJob(input);
  const mipmaps = createTreeImpostorMipJob(input);
  let phase: "dilation" | "mipmaps" | "done" = "dilation";

  return {
    step(maxOperations = DEFAULT_DILATION_OPERATIONS): boolean {
      if (phase === "dilation") {
        if (!dilation.step(maxOperations)) return false;
        phase = "mipmaps";
        return false;
      }
      if (phase === "mipmaps") {
        if (!mipmaps.step(maxOperations)) return false;
        const result = mipmaps.result();
        layouts.albedo.mipmaps = result.albedo;
        layouts.normalDepth.mipmaps = result.normalDepth;
        phase = "done";
      }
      return true;
    },
    completed: () => dilation.completed(),
    total: () => dilation.total(),
  };
}

export function dilateTreeImpostorAtlasTiles(input: TreeImpostorAtlasPixels): void {
  const job = createTreeImpostorAtlasDilationJob(input);
  while (!job.step(Number.MAX_SAFE_INTEGER)) {
    // Synchronous compatibility path.
  }
}

function registerPixelLayouts(
  albedo: Uint8Array,
  normalDepth: Uint8Array,
  tileSize: number,
): { albedo: TreeImpostorPixelLayout; normalDepth: TreeImpostorPixelLayout } {
  const albedoLayout: TreeImpostorPixelLayout = {
    tileSize,
    channel: "albedo",
    coveragePixels: albedo,
    mipmaps: null,
  };
  const normalDepthLayout: TreeImpostorPixelLayout = {
    tileSize,
    channel: "normal-depth",
    coveragePixels: albedo,
    mipmaps: null,
  };
  PIXEL_LAYOUTS.set(albedo, albedoLayout);
  PIXEL_LAYOUTS.set(normalDepth, normalDepthLayout);
  return { albedo: albedoLayout, normalDepth: normalDepthLayout };
}

function validatePixelBuffer(pixels: Uint8Array, width: number, height: number, operation: string): void {
  const expectedLength = width * height * BYTES_PER_PIXEL;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`${operation} received invalid dimensions ${width}x${height}`);
  }
  if (pixels.length !== expectedLength) {
    throw new Error(`${operation} received ${pixels.length} bytes; expected ${expectedLength}`);
  }
}
