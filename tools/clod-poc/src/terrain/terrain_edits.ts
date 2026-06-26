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

function densityAfterEdit(edit: DigEdit, x: number, y: number, z: number, currentDensity: number): number {
  const h = editHeight(edit);
  const sdf = brushSdf(edit.shape, x - edit.x, y - edit.y, z - edit.z, edit.r, h);
  const full = edit.op === "add" ? Math.max(currentDensity, -sdf) : Math.min(currentDensity, sdf);
  const feather = Math.max(1e-3, (edit.falloff ?? 0) * edit.r);
  const weight = Math.min(1, Math.max(0, -sdf / feather)) * (edit.strength ?? 1);
  return currentDensity + (full - currentDensity) * weight;
}

function voxelTransactionFromDigEdit(edit: DigEdit, id: number): VoxelEditTransaction {
  const h = editHeight(edit);
  const r = edit.r + DIG_INFLUENCE_MARGIN;
  const minX = Math.floor(edit.x - r);
  const maxX = Math.ceil(edit.x + r);
  const minY = Math.max(BEDROCK_Y + 1, Math.floor(edit.y - h - DIG_INFLUENCE_MARGIN));
  const maxY = Math.ceil(edit.y + h + DIG_INFLUENCE_MARGIN);
  const minZ = Math.floor(edit.z - r);
  const maxZ = Math.ceil(edit.z + r);
  const deltas: VoxelEditTransaction["deltas"] extends readonly (infer T)[] ? T[] : never = [];

  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        const before = editedDensityAt(x, y, z);
        const after = densityAfterEdit(edit, x, y, z, before);
        const materialSlot = edit.op === "add" && edit.material !== undefined ? Math.max(0, edit.material | 0) : undefined;
        if (Math.abs(after - before) <= 1e-6 && materialSlot === undefined) continue;
        deltas.push({ x, y, z, density: after, materialSlot });
      }
    }
  }

  return {
    id,
    source: "brush",
    revisionBase: voxelEditStore.revision(),
    deltas,
  };
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
  switch (shape) {
    case "cube": {
      const qx = Math.abs(dx) - r, qy = Math.abs(dy) - h, qz = Math.abs(dz) - r;
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
      return outside + Math.min(Math.max(qx, qy, qz), 0);
    }
    case "cylinder": {
      const dRadial = Math.hypot(dx, dz) - r, dAxial = Math.abs(dy) - h;
      const outside = Math.hypot(Math.max(dRadial, 0), Math.max(dAxial, 0));
      return outside + Math.min(Math.max(dRadial, dAxial), 0);
    }
    default:
      return Math.hypot(dx, (dy * r) / h, dz) - r;
  }
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
