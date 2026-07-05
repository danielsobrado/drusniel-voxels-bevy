export interface StreamCenter {
  x: number;
  z: number;
}

export interface LiveChunkCoord {
  x: number;
  z: number;
}

export function liveChunkKey(coord: LiveChunkCoord): string {
  return `${coord.x},${coord.z}`;
}

const PACK_COORD_OFFSET = 1_048_576;
const PACK_COORD_STRIDE = PACK_COORD_OFFSET * 2;

export function packLiveKey(x: number, z: number): number {
  return (x + PACK_COORD_OFFSET) * PACK_COORD_STRIDE + (z + PACK_COORD_OFFSET);
}

export function parseLiveChunkKey(key: string): LiveChunkCoord {
  const [x, z] = key.split(",").map(Number);
  if (!Number.isInteger(x) || !Number.isInteger(z)) throw new Error(`Invalid live chunk key ${key}`);
  return { x, z };
}
