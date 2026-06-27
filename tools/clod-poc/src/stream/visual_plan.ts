import type { StreamingOwnershipRadii } from "../streaming/streaming_ownership.js";
import type { StreamCenter } from "./live_voxel_chunk_streamer.js";

export interface VisualPlanConfig {
  tileSizeM: number;
  maxLevel: number;
}

export function visualTileKey(level: number, x: number, z: number): string {
  return String(level) + ":" + String(x) + "," + String(z);
}

function tileDistance(center: StreamCenter, x: number, z: number, size: number): number {
  const tileX = (x + 0.5) * size;
  const tileZ = (z + 0.5) * size;
  const dx = tileX - center.x;
  const dz = tileZ - center.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function planVisualTiles(
  center: StreamCenter,
  ownership: StreamingOwnershipRadii,
  config: VisualPlanConfig,
): string[] {
  const keys = new Set<string>();
  for (let level = 0; level <= config.maxLevel; level++) {
    const size = config.tileSizeM * 2 ** level;
    const minX = Math.floor((center.x - ownership.clodRadiusM) / size);
    const maxX = Math.floor((center.x + ownership.clodRadiusM) / size);
    const minZ = Math.floor((center.z - ownership.clodRadiusM) / size);
    const maxZ = Math.floor((center.z + ownership.clodRadiusM) / size);
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        const distance = tileDistance(center, x, z, size);
        if (distance <= ownership.liveRadiusM) continue;
        if (distance > ownership.clodRadiusM + size * Math.SQRT2 * 0.5) continue;
        keys.add(visualTileKey(level, x, z));
      }
    }
  }
  return Array.from(keys).sort();
}
