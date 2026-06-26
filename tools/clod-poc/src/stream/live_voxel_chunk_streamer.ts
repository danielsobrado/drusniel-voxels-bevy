import type { StreamingOwnershipRadii } from "../streaming/streaming_ownership.js";

export interface StreamCenter {
  x: number;
  z: number;
}

export interface LiveChunkCoord {
  x: number;
  z: number;
}

export interface LiveVoxelChunkPlanConfig {
  chunkSizeM: number;
}

export function liveChunkKey(coord: LiveChunkCoord): string {
  return `${coord.x},${coord.z}`;
}

export function requiredLiveChunks(
  center: StreamCenter,
  ownership: StreamingOwnershipRadii,
  config: LiveVoxelChunkPlanConfig,
): string[] {
  const radius = ownership.liveRadiusM;
  const chunkSize = config.chunkSizeM;
  const minX = Math.floor((center.x - radius) / chunkSize);
  const maxX = Math.floor((center.x + radius) / chunkSize);
  const minZ = Math.floor((center.z - radius) / chunkSize);
  const maxZ = Math.floor((center.z + radius) / chunkSize);
  const required = new Set<string>();
  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      const cx = (x + 0.5) * chunkSize;
      const cz = (z + 0.5) * chunkSize;
      if (Math.hypot(cx - center.x, cz - center.z) <= radius + chunkSize * Math.SQRT2 * 0.5) {
        required.add(liveChunkKey({ x, z }));
      }
    }
  }
  return [...required].sort();
}
