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

export function parseLiveChunkKey(key: string): LiveChunkCoord {
  const [x, z] = key.split(",").map(Number);
  if (!Number.isInteger(x) || !Number.isInteger(z)) throw new Error(`Invalid live chunk key ${key}`);
  return { x, z };
}
