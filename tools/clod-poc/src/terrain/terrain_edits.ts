import { sampleBrushSdf, type SdfBrush } from "./sdf/sdf_brush.js";
import { rasterizeSdfBrushToVoxelTransaction } from "./sdf/sdf_rasterizer.js";
import { surfaceHeight } from "./terrain_surface.js";
import { voxelEditStore } from "./voxel_edits/voxel_edit_store.js";
import type { VoxelEditTransaction } from "./voxel_edits/voxel_edit_types.js";

export type BrushShape = "sphere" | "cube" | "cylinder";
export type BrushOp = "remove" | "add";

export interface DigEdit {
  x: number;
  y: number;
  z: number;
  r: number;
  shape?: BrushShape;
  op?: BrushOp;
  material?: number;
  height?: number;
  strength?: number;
  falloff?: number;
}

export const BEDROCK_Y = 1;
export const DIG_INFLUENCE_MARGIN = 4;

export const CELL_SHIFT = 4;
export const CELL_SIZE = 16;

export type CellKey = number;

export function cellKey(x: number, y: number, z: number): CellKey {
  return ((x >> CELL_SHIFT) * 1048576 + (y >> CELL_SHIFT)) * 1048576 + (z >> CELL_SHIFT);
}

export function overlappingCells(ex: number, ey: number, ez: number, r: number, h: number): CellKey[] {
  const minX = Math.floor((ex - r) / CELL_SIZE);
  const maxX = Math.floor((ex + r) / CELL_SIZE);
  const minY = Math.floor((ey - h) / CELL_SIZE);
  const maxY = Math.floor((ey + h) / CELL_SIZE);
  const minZ = Math.floor((ez - r) / CELL_SIZE);
  const maxZ = Math.floor((ez + r) / CELL_SIZE);
  const keys: CellKey[] = [];
  for (let cx = minX; cx <= maxX; cx++) {
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        keys.push(((cx * 1048576 + cy) * 1048576 + cz));
      }
    }
  }
  return keys;
}

export const editIndex = new Map<CellKey, DigEdit[]>();
let digEditRevision = 0;
export const editIds = new WeakMap<DigEdit, number>();
let editIdCounter = 0;
export const activePaintSlots = new Set<number>();

function proceduralDensity(x: number, y: number, z: number): number {
  return surfaceHeight(x, z) - y;
}

function editedDensityAt(x: number, y: number, z: number): number {
  return voxelEditStore.sampleDensity(x, y, z, proceduralDensity);
}

function sdfBrushFromDigEdit(edit: DigEdit): SdfBrush {
  return {
    x: edit.x,
    y: edit.y,
    z: edit.z,
    radius: edit.r,
    height: editHeight(edit),
    shape: edit.shape ?? "sphere",
    op: edit.op ?? "remove",
    strength: edit.strength ?? 1,
    falloff: edit.falloff ?? 0,
    materialSlot: edit.material,
  };
}

function voxelTransactionFromDigEdit(edit: DigEdit, id: number): VoxelEditTransaction {
  const h = editHeight(edit);
  const r = edit.r + DIG_INFLUENCE_MARGIN;
  return rasterizeSdfBrushToVoxelTransaction({
    id,
    revisionBase: voxelEditStore.revision(),
    brush: sdfBrushFromDigEdit(edit),
    bounds: {
      minX: Math.floor(edit.x - r),
      maxX: Math.ceil(edit.x + r),
      minY: Math.max(BEDROCK_Y + 1, Math.floor(edit.y - h - DIG_INFLUENCE_MARGIN)),
      maxY: Math.ceil(edit.y + h + DIG_INFLUENCE_MARGIN),
      minZ: Math.floor(edit.z - r),
      maxZ: Math.ceil(edit.z + r),
    },
    sampleDensity: editedDensityAt,
  });
}

export function addDigEdit(edit: DigEdit): void {
  const id = ++editIdCounter;
  const h = editHeight(edit);
  const r = edit.r + DIG_INFLUENCE_MARGIN;
  for (const key of overlappingCells(edit.x, edit.y, edit.z, r, h)) {
    let bucket = editIndex.get(key);
    if (!bucket) {
      bucket = [];
      editIndex.set(key, bucket);
    }
    const copy = { ...edit };
    editIds.set(copy, id);
    bucket.push(copy);
  }
  if (edit.op === "add") activePaintSlots.add(Math.max(0, edit.material ?? 0));
  voxelEditStore.apply(voxelTransactionFromDigEdit(edit, id));
  digEditRevision++;
}

export function getDigEditsSnapshot(): DigEdit[] {
  const seen = new Set<number>();
  const all: DigEdit[] = [];
  for (const bucket of editIndex.values()) {
    for (const edit of bucket) {
      const id = editIds.get(edit) ?? 0;
      if (!seen.has(id)) {
        seen.add(id);
        all.push({ ...edit });
      }
    }
  }
  return all;
}

export function replaceDigEdits(edits: readonly DigEdit[]): void {
  editIndex.clear();
  activePaintSlots.clear();
  voxelEditStore.clear();
  for (const edit of edits) addDigEdit(edit);
}

export function clearDigEdits(): void {
  editIndex.clear();
  activePaintSlots.clear();
  voxelEditStore.clear();
  digEditRevision++;
}

export function digEditCount(): number {
  let n = 0;
  for (const bucket of editIndex.values()) n += bucket.length;
  return n;
}

export function getDigEditRevision(): number {
  return Math.max(digEditRevision, voxelEditStore.revision());
}

export function brushSdf(shape: BrushShape | undefined, dx: number, dy: number, dz: number, r: number, h: number): number {
  return sampleBrushSdf(shape ?? "sphere", dx, dy, dz, r, h);
}

export function editHeight(e: DigEdit): number {
  return e.height ?? e.r;
}

export function densityFromEdits(
  x: number, y: number, z: number,
  baseDensity: number,
): number {
  return voxelEditStore.sampleDensity(x, y, z, () => baseDensity);
}

export function collectOverlappingEdits(
  x0: number, x1: number, z0: number, z1: number,
): DigEdit[] {
  const visited = new Set<number>();
  const chunkEdits: DigEdit[] = [];
  const minGX = Math.max(0, Math.floor(x0 / CELL_SIZE) - 1);
  const maxGX = Math.floor((x1 - 1) / CELL_SIZE) + 1;
  const minGZ = Math.max(0, Math.floor(z0 / CELL_SIZE) - 1);
  const maxGZ = Math.floor((z1 - 1) / CELL_SIZE) + 1;
  for (let gx = minGX; gx <= maxGX; gx++) {
    for (let gz = minGZ; gz <= maxGZ; gz++) {
      for (let gy = 0; gy < 32; gy++) {
        const key = (gx * 1048576 + gy) * 1048576 + gz;
        const bucket = editIndex.get(key);
        if (!bucket) continue;
        for (const e of bucket) {
          const id = editIds.get(e) ?? 0;
          if (!visited.has(id)) {
            visited.add(id);
            chunkEdits.push(e);
          }
        }
      }
    }
  }
  return chunkEdits;
}

export function getVoxelEditSnapshot() {
  return voxelEditStore.snapshot();
}

export function replaceVoxelEdits(snapshot: ReturnType<typeof getVoxelEditSnapshot>): void {
  editIndex.clear();
  activePaintSlots.clear();
  voxelEditStore.load(snapshot);
  digEditRevision = Math.max(digEditRevision + 1, snapshot.revision);
}
