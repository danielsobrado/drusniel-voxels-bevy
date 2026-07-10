import { voxelEditStore } from "./voxel_edits/voxel_edit_store.js";

export const MATERIAL_PAINT_BAND = 0.75;
export const PAINT_BLEND_CHANNELS = 4;
export const PAINT_FADE = 3.0;

export interface VertexPaint {
  slots: number[];
  weights: number[];
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export function terrainWeights(y: number, ny: number): [number, number, number, number] {
  void ny;
  const WATER_LEVEL = 18;
  const sand = clamp01(1 - Math.abs(y - WATER_LEVEL) / 6);
  const snow = clamp01((y - 88) / 22);
  const rock = clamp01((y - 48) / 34) * (1 - snow);
  const grass = clamp01(1 - sand - snow - rock);
  const sum = sand + snow + rock + grass || 1;
  return [grass / sum, rock / sum, sand / sum, snow / sum];
}

export function paintMaterialAt(x: number, y: number, z: number): number {
  const voxelSlot = voxelEditStore.materialAt(x, y, z);
  if (voxelSlot !== undefined) return voxelSlot + 1;

  return 0;
}

export function paintWeightsAt(x: number, y: number, z: number): VertexPaint {
  const slots = new Array<number>(PAINT_BLEND_CHANNELS).fill(-1);
  const weights = new Array<number>(PAINT_BLEND_CHANNELS).fill(0);

  const globalSlots = voxelEditStore.materialSlots();
  for (let c = 0; c < Math.min(globalSlots.length, PAINT_BLEND_CHANNELS); c++) {
    slots[c] = globalSlots[c];
  }

  const voxelSlot = voxelEditStore.materialAt(x, y, z);
  if (voxelSlot !== undefined) {
    if (!slots.includes(voxelSlot)) slots[0] = voxelSlot;
    const slotIndex = Math.max(0, slots.indexOf(voxelSlot));
    weights[slotIndex] = 1;
    return { slots, weights };
  }

  return { slots, weights };
}
