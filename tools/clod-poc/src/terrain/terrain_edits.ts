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

let digEditRevision = 0;
let editIdCounter = 0;
const brushHistory: Array<{ id: number; edit: DigEdit }> = [];
let voxelHistoryComplete = true;

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

export function voxelTransactionFromDigEdit(edit: DigEdit): VoxelEditTransaction {
  const id = ++editIdCounter;
  const h = editHeight(edit);
  const r = edit.r + DIG_INFLUENCE_MARGIN;
  const transaction = rasterizeSdfBrushToVoxelTransaction({
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
  return {
    ...transaction,
    previousValues: transaction.deltas.map(({ x, y, z }) => {
      const previous = voxelEditStore.voxelAt(x, y, z);
      return { x, y, z, value: previous ? { ...previous } : null };
    }),
  };
}

export function applyDigEditTransaction(transaction: VoxelEditTransaction, edit?: DigEdit): void {
  voxelEditStore.apply(transaction);
  if (edit) brushHistory.push({ id: transaction.id, edit: { ...edit } });
  digEditRevision++;
}

export function rollbackDigEditTransaction(transaction: VoxelEditTransaction): void {
  voxelEditStore.rollback(transaction);
  let historyIndex = -1;
  for (let i = brushHistory.length - 1; i >= 0; i--) {
    if (brushHistory[i]!.id === transaction.id) {
      historyIndex = i;
      break;
    }
  }
  if (historyIndex >= 0) brushHistory.splice(historyIndex, 1);
  digEditRevision++;
}

export function addDigEdit(edit: DigEdit): void {
  applyDigEditTransaction(voxelTransactionFromDigEdit(edit), edit);
}

export function getDigEditsSnapshot(): DigEdit[] {
  return brushHistory.map(({ edit }) => ({ ...edit }));
}

export function replaceDigEdits(edits: readonly DigEdit[]): void {
  brushHistory.length = 0;
  voxelEditStore.clear();
  voxelHistoryComplete = true;
  for (const edit of edits) addDigEdit(edit);
}

export function clearDigEdits(): void {
  brushHistory.length = 0;
  voxelEditStore.clear();
  voxelHistoryComplete = true;
  digEditRevision++;
}

export function digEditCount(): number {
  return brushHistory.length;
}

export function hasPaintedTerrainEdits(): boolean {
  return voxelEditStore.materialSlots().length > 0;
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
  return brushHistory
    .map(({ edit }) => edit)
    .filter((edit) => {
      const radius = edit.r + DIG_INFLUENCE_MARGIN;
      return edit.x + radius >= x0 && edit.x - radius < x1 && edit.z + radius >= z0 && edit.z - radius < z1;
    });
}

export function getVoxelEditSnapshot() {
  return voxelEditStore.snapshot();
}

export function getVoxelEditSnapshotForBounds(minX: number, maxX: number, minZ: number, maxZ: number) {
  return voxelEditStore.snapshotBounds(minX, maxX, minZ, maxZ);
}

export function voxelEditCount(): number {
  return voxelEditStore.count();
}

export function voxelEditsRequireCpuDerivedMeshing(): boolean {
  return !voxelHistoryComplete && voxelEditStore.hasEdits();
}

export function replaceVoxelEdits(snapshot: ReturnType<typeof getVoxelEditSnapshot>): void {
  brushHistory.length = 0;
  voxelEditStore.load(snapshot);
  voxelHistoryComplete = snapshot.deltas.length === 0;
  digEditRevision = Math.max(digEditRevision + 1, snapshot.revision);
}
