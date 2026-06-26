import type { StreamingOwnershipRadii } from "../streaming/streaming_ownership.js";
import { parseLiveChunkKey, type StreamCenter } from "./live_chunk_keys.js";
import type { LiveVoxelChunkPlanConfig } from "./live_voxel_chunk_streamer.js";

export function evictableLiveChunks(
  loadedKeys: Iterable<string>,
  center: StreamCenter,
  ownership: StreamingOwnershipRadii,
  config: LiveVoxelChunkPlanConfig,
  hysteresisM: number,
): string[] {
  const evictable: string[] = [];
  const evictRadius = ownership.liveRadiusM + hysteresisM;
  for (const key of loadedKeys) {
    const coord = parseLiveChunkKey(key);
    const cx = (coord.x + 0.5) * config.chunkSizeM;
    const cz = (coord.z + 0.5) * config.chunkSizeM;
    if (Math.hypot(cx - center.x, cz - center.z) > evictRadius) evictable.push(key);
  }
  return evictable.sort();
}
