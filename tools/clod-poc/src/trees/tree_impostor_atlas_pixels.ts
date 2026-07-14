const BYTES_PER_PIXEL = 4;
const COVERAGE_THRESHOLD = 8;

export interface TreeImpostorAtlasPixels {
  albedo: Uint8Array;
  normalDepth: Uint8Array;
  width: number;
  height: number;
  tileSize: number;
}

export function copyTreeImpostorPixels(raw: ArrayBufferView, expectedLength: number): Uint8Array {
  const source = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  if (source.length !== expectedLength) {
    throw new Error(`tree impostor readback returned ${source.length} bytes; expected ${expectedLength}`);
  }
  return source.slice();
}

export function flipTreeImpostorPixelRows(pixels: Uint8Array, width: number, height: number): void {
  validatePixelBuffer(pixels, width, height, "tree impostor row flip");
  const rowLength = width * BYTES_PER_PIXEL;
  const row = new Uint8Array(rowLength);
  for (let y = 0; y < Math.floor(height / 2); y++) {
    const top = y * rowLength;
    const bottom = (height - 1 - y) * rowLength;
    row.set(pixels.subarray(top, top + rowLength));
    pixels.copyWithin(top, bottom, bottom + rowLength);
    pixels.set(row, bottom);
  }
}

export function dilateTreeImpostorAtlasTiles(input: TreeImpostorAtlasPixels): void {
  const { albedo, normalDepth, width, height, tileSize } = input;
  validatePixelBuffer(albedo, width, height, "tree impostor albedo dilation");
  validatePixelBuffer(normalDepth, width, height, "tree impostor normal-depth dilation");
  if (!Number.isInteger(tileSize) || tileSize <= 0 || width % tileSize !== 0 || height % tileSize !== 0) {
    throw new Error(`tree impostor tile size ${tileSize} does not divide ${width}x${height}`);
  }

  for (let tileY = 0; tileY < height; tileY += tileSize) {
    for (let tileX = 0; tileX < width; tileX += tileSize) {
      dilateTile(albedo, normalDepth, width, tileX, tileY, tileSize);
    }
  }
}

function dilateTile(
  albedo: Uint8Array,
  normalDepth: Uint8Array,
  atlasWidth: number,
  originX: number,
  originY: number,
  tileSize: number,
): void {
  const pixelCount = tileSize * tileSize;
  const filled = new Uint8Array(pixelCount);
  const queued = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let head = 0;
  let tail = 0;

  const localIndex = (x: number, y: number): number => y * tileSize + x;
  const atlasOffset = (x: number, y: number): number => (
    (originY + y) * atlasWidth + originX + x
  ) * BYTES_PER_PIXEL;
  const enqueue = (x: number, y: number): void => {
    const index = localIndex(x, y);
    if (filled[index] || queued[index] || tail >= queue.length) return;
    queued[index] = 1;
    queue[tail++] = index;
  };

  for (let y = 0; y < tileSize; y++) {
    for (let x = 0; x < tileSize; x++) {
      const index = localIndex(x, y);
      const offset = atlasOffset(x, y);
      filled[index] = (albedo[offset + 3] as number) > COVERAGE_THRESHOLD ? 1 : 0;
    }
  }

  for (let y = 0; y < tileSize; y++) {
    for (let x = 0; x < tileSize; x++) {
      const index = localIndex(x, y);
      if (!filled[index] && hasFilledNeighbour(filled, x, y, tileSize)) enqueue(x, y);
    }
  }

  while (head < tail) {
    const index = queue[head++] as number;
    queued[index] = 0;
    if (filled[index]) continue;
    const x = index % tileSize;
    const y = Math.floor(index / tileSize);
    let count = 0;
    let albedoR = 0;
    let albedoG = 0;
    let albedoB = 0;
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
        if (!filled[localIndex(nx, ny)]) continue;
        const offset = atlasOffset(nx, ny);
        albedoR += albedo[offset] as number;
        albedoG += albedo[offset + 1] as number;
        albedoB += albedo[offset + 2] as number;
        normalR += normalDepth[offset] as number;
        normalG += normalDepth[offset + 1] as number;
        normalB += normalDepth[offset + 2] as number;
        depth += normalDepth[offset + 3] as number;
        count++;
      }
    }
    if (count === 0) continue;

    const target = atlasOffset(x, y);
    albedo[target] = Math.round(albedoR / count);
    albedo[target + 1] = Math.round(albedoG / count);
    albedo[target + 2] = Math.round(albedoB / count);
    normalDepth[target] = Math.round(normalR / count);
    normalDepth[target + 1] = Math.round(normalG / count);
    normalDepth[target + 2] = Math.round(normalB / count);
    normalDepth[target + 3] = Math.round(depth / count);
    filled[index] = 1;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= tileSize || ny >= tileSize) continue;
        enqueue(nx, ny);
      }
    }
  }
}

function hasFilledNeighbour(filled: Uint8Array, x: number, y: number, tileSize: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= tileSize || ny >= tileSize) continue;
      if (filled[ny * tileSize + nx]) return true;
    }
  }
  return false;
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
