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
  for (const edit of edits) addDigEdit(edit);
}

export function clearDigEdits(): void {
  editIndex.clear();
  activePaintSlots.clear();
  digEditRevision++;
}

export function digEditCount(): number {
  let n = 0;
  for (const bucket of editIndex.values()) n += bucket.length;
  return n;
}

export function getDigEditRevision(): number {
  return digEditRevision;
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
  let d = baseDensity;
  if (editIndex.size > 0 && y > BEDROCK_Y) {
    const key = cellKey(x, y, z);
    const bucket = editIndex.get(key);
    if (bucket) {
      for (const e of bucket) {
        const h = editHeight(e);
        const dx = x - e.x, dy = y - e.y, dz = z - e.z;
        const sdf = brushSdf(e.shape, dx, dy, dz, e.r, h);
        const full = (e.op === "add") ? Math.max(d, -sdf) : Math.min(d, sdf);
        const feather = Math.max(1e-3, (e.falloff ?? 0) * e.r);
        const weight = Math.min(1, Math.max(0, -sdf / feather)) * (e.strength ?? 1);
        d += (full - d) * weight;
      }
    }
  }
  return d;
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
