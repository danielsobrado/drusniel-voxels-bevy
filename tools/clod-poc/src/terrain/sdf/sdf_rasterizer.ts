import type { BaseDensitySampler, VoxelChunkKey, VoxelEditTransaction } from "../voxel_edits/voxel_edit_types.js";
import { voxelChunkKeyFor, voxelChunkKeyString, VOXEL_CHUNK_SIZE } from "../voxel_edits/voxel_keys.js";
import { applySampledBrushSdfToDensity, sampleBrushSdf, type SdfBrush } from "./sdf_brush.js";

export interface SdfRasterBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface SdfBrushRasterizeInput {
  id: number;
  revisionBase: number;
  brush: SdfBrush;
  bounds: SdfRasterBounds;
  sampleDensity: BaseDensitySampler;
  epsilon?: number;
}

function emptyTransaction(input: SdfBrushRasterizeInput): VoxelEditTransaction {
  return {
    id: input.id,
    source: "sdf-brush",
    revisionBase: input.revisionBase,
    deltas: [],
    previousValues: [],
    dirtyChunks: [],
    dirtyBounds: { ...input.bounds },
    affectedMaterialSlots: [],
  };
}

export function rasterizeSdfBrushToVoxelTransaction(
  input: SdfBrushRasterizeInput,
): VoxelEditTransaction {
  if (!Number.isFinite(input.brush.strength) || !Number.isFinite(input.brush.radius) || !Number.isFinite(input.brush.height)) {
    throw new Error("SDF brush dimensions and strength must be finite");
  }
  if (input.brush.strength <= 0 || input.brush.radius <= 0 || input.brush.height <= 0) {
    return emptyTransaction(input);
  }

  const epsilon = input.epsilon ?? 1e-6;
  const deltas: VoxelEditTransaction["deltas"] extends readonly (infer T)[] ? T[] : never = [];
  const dirtyChunks = new Map<string, VoxelChunkKey>();
  const affectedMaterialSlots = new Set<number>();

  const minChunkX = Math.floor(input.bounds.minX / VOXEL_CHUNK_SIZE);
  const maxChunkX = Math.floor(input.bounds.maxX / VOXEL_CHUNK_SIZE);
  const minChunkY = Math.floor(input.bounds.minY / VOXEL_CHUNK_SIZE);
  const maxChunkY = Math.floor(input.bounds.maxY / VOXEL_CHUNK_SIZE);
  const minChunkZ = Math.floor(input.bounds.minZ / VOXEL_CHUNK_SIZE);
  const maxChunkZ = Math.floor(input.bounds.maxZ / VOXEL_CHUNK_SIZE);

  for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
    const minX = Math.max(input.bounds.minX, chunkX * VOXEL_CHUNK_SIZE);
    const maxX = Math.min(input.bounds.maxX, (chunkX + 1) * VOXEL_CHUNK_SIZE - 1);
    for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY++) {
      const minY = Math.max(input.bounds.minY, chunkY * VOXEL_CHUNK_SIZE);
      const maxY = Math.min(input.bounds.maxY, (chunkY + 1) * VOXEL_CHUNK_SIZE - 1);
      for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ++) {
        const minZ = Math.max(input.bounds.minZ, chunkZ * VOXEL_CHUNK_SIZE);
        const maxZ = Math.min(input.bounds.maxZ, (chunkZ + 1) * VOXEL_CHUNK_SIZE - 1);
        const nearestX = Math.min(maxX, Math.max(minX, input.brush.x));
        const nearestY = Math.min(maxY, Math.max(minY, input.brush.y));
        const nearestZ = Math.min(maxZ, Math.max(minZ, input.brush.z));
        if (sampleBrushSdf(
          input.brush.shape,
          nearestX - input.brush.x,
          nearestY - input.brush.y,
          nearestZ - input.brush.z,
          input.brush.radius,
          input.brush.height,
        ) > 0) continue;

        for (let x = minX; x <= maxX; x++) {
          for (let y = minY; y <= maxY; y++) {
            for (let z = minZ; z <= maxZ; z++) {
              const sdf = sampleBrushSdf(
                input.brush.shape,
                x - input.brush.x,
                y - input.brush.y,
                z - input.brush.z,
                input.brush.radius,
                input.brush.height,
              );
              if (sdf > 0) continue;
              const before = input.sampleDensity(x, y, z);
              const after = applySampledBrushSdfToDensity(input.brush, sdf, before);
              const materialSlot = input.brush.op === "add" && input.brush.materialSlot !== undefined
                ? Math.max(0, input.brush.materialSlot | 0)
                : undefined;
              if (Math.abs(after - before) <= epsilon && materialSlot === undefined) continue;
              deltas.push({ x, y, z, density: after, materialSlot });
              const chunk = voxelChunkKeyFor(x, y, z);
              dirtyChunks.set(voxelChunkKeyString(chunk), chunk);
              if (materialSlot !== undefined) affectedMaterialSlots.add(materialSlot);
            }
          }
        }
      }
    }
  }

  return {
    id: input.id,
    source: "sdf-brush",
    revisionBase: input.revisionBase,
    deltas,
    previousValues: [],
    dirtyChunks: [...dirtyChunks.values()],
    dirtyBounds: { ...input.bounds },
    affectedMaterialSlots: [...affectedMaterialSlots].sort((a, b) => a - b),
  };
}
