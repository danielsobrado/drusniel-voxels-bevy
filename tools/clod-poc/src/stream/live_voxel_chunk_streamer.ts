import type { StreamingOwnershipRadii } from "../streaming/streaming_ownership.js";
import { evictableLiveChunks } from "./live_chunk_eviction.js";
import type { StreamCenter } from "./live_chunk_keys.js";
import { liveChunkKey } from "./live_chunk_keys.js";

export interface LiveVoxelChunkPlanConfig {
  chunkSizeM: number;
}

export interface LiveVoxelChunkStreamerConfig extends LiveVoxelChunkPlanConfig {
  hysteresisM: number;
}

export interface LiveVoxelChunkStreamerSnapshot {
  center: StreamCenter;
  required: readonly string[];
  loaded: readonly string[];
  evictable: readonly string[];
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

export class LiveVoxelChunkStreamer {
  private center: StreamCenter = { x: 0, z: 0 };
  private readonly loaded = new Set<string>();

  constructor(
    private readonly ownership: StreamingOwnershipRadii,
    private readonly config: LiveVoxelChunkStreamerConfig,
  ) {}

  update(center: StreamCenter): LiveVoxelChunkStreamerSnapshot {
    this.center = { ...center };
    const required = requiredLiveChunks(this.center, this.ownership, this.config);
    for (const key of required) this.loaded.add(key);
    const evictable = evictableLiveChunks(this.loaded, this.center, this.ownership, this.config, this.config.hysteresisM);
    for (const key of evictable) this.loaded.delete(key);
    return {
      center: { ...this.center },
      required,
      loaded: [...this.loaded].sort(),
      evictable,
    };
  }

  snapshot(): LiveVoxelChunkStreamerSnapshot {
    const required = requiredLiveChunks(this.center, this.ownership, this.config);
    const evictable = evictableLiveChunks(this.loaded, this.center, this.ownership, this.config, this.config.hysteresisM);
    return {
      center: { ...this.center },
      required,
      loaded: [...this.loaded].sort(),
      evictable,
    };
  }
}
