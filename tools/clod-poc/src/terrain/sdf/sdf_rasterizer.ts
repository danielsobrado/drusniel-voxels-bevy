import type { BaseDensitySampler, VoxelEditTransaction } from "../voxel_edits/voxel_edit_types.js";
import { applyBrushSdfToDensity, type SdfBrush } from "./sdf_brush.js";

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

export function rasterizeSdfBrushToVoxelTransaction(
  input: SdfBrushRasterizeInput,
): VoxelEditTransaction {
  const epsilon = input.epsilon ?? 1e-6;
  const deltas: VoxelEditTransaction["deltas"] extends readonly (infer T)[] ? T[] : never = [];

  for (let x = input.bounds.minX; x <= input.bounds.maxX; x++) {
    for (let y = input.bounds.minY; y <= input.bounds.maxY; y++) {
      for (let z = input.bounds.minZ; z <= input.bounds.maxZ; z++) {
        const before = input.sampleDensity(x, y, z);
        const after = applyBrushSdfToDensity(input.brush, x, y, z, before);
        const materialSlot = input.brush.op === "add" && input.brush.materialSlot !== undefined
          ? Math.max(0, input.brush.materialSlot | 0)
          : undefined;
        if (Math.abs(after - before) <= epsilon && materialSlot === undefined) continue;
        deltas.push({ x, y, z, density: after, materialSlot });
      }
    }
  }

  return {
    id: input.id,
    source: "sdf-brush",
    revisionBase: input.revisionBase,
    deltas,
  };
}
