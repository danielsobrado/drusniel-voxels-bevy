import { sampleBrushSdf, type SdfBrush } from "./sdf/sdf_brush.js";
import { rasterizeSdfBrushToVoxelTransaction } from "./sdf/sdf_rasterizer.js";
import { surfaceHeight } from "./terrain_surface.js";
import { voxelEditStore } from "./voxel_edits/voxel_edit_store.js";
import { voxelChunkKeyFor, voxelChunkKeyString } from "./voxel_edits/voxel_keys.js";
import type {
  VoxelChunkKey,
  VoxelDeltaBefore,
  VoxelEditBounds,
  VoxelEditTransaction,
} from "./voxel_edits/voxel_edit_types.js";

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

export interface TerrainConformEdit {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  targetY: number;
  fillDepthM: number;
  trimHeightM: number;
  falloffM: number;
  materialSlot: number;
}

export const BEDROCK_Y = 1;
export const DIG_INFLUENCE_MARGIN = 4;

const TERRAIN_CONFORM_DENSITY_EPSILON = 0.0001;
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

function smoothStep(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function terrainConformWeight(edit: TerrainConformEdit, x: number, z: number): number {
  const edgeDistance = Math.min(
    x - edit.minX,
    edit.maxX - x,
    z - edit.minZ,
    edit.maxZ - z,
  );
  if (edgeDistance < 0) return 0;
  if (edit.falloffM <= 0) return 1;
  return smoothStep(edgeDistance / edit.falloffM);
}

function transactionPreviousValues(
  deltas: readonly { x: number; y: number; z: number }[],
): VoxelDeltaBefore[] {
  return deltas.map(({ x, y, z }) => {
    const previous = voxelEditStore.voxelAt(x, y, z);
    return { x, y, z, value: previous ? { ...previous } : null };
  });
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
    previousValues: transactionPreviousValues(transaction.deltas),
  };
}

export function voxelTransactionFromTerrainConform(edit: TerrainConformEdit): VoxelEditTransaction {
  if (!(edit.maxX > edit.minX) || !(edit.maxZ > edit.minZ)) {
    throw new Error("terrain conform footprint must have positive area");
  }
  const minY = Math.max(BEDROCK_Y + 1, Math.floor(edit.targetY - edit.fillDepthM));
  const maxY = Math.ceil(edit.targetY + edit.trimHeightM);
  const bounds: VoxelEditBounds = {
    minX: Math.floor(edit.minX),
    maxX: Math.ceil(edit.maxX),
    minY,
    maxY,
    minZ: Math.floor(edit.minZ),
    maxZ: Math.ceil(edit.maxZ),
  };
  const deltas: Array<{ x: number; y: number; z: number; density: number; materialSlot?: number }> = [];
  const dirtyChunks = new Map<string, VoxelChunkKey>();
  for (let z = bounds.minZ; z <= bounds.maxZ; z += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const weight = terrainConformWeight(edit, x, z);
      if (weight <= 0) continue;
      for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
        const currentDensity = editedDensityAt(x, y, z);
        const planeDensity = edit.targetY - y;
        const constrainedDensity = y <= edit.targetY
          ? Math.max(currentDensity, planeDensity)
          : Math.min(currentDensity, planeDensity);
        const density = currentDensity + (constrainedDensity - currentDensity) * weight;
        if (Math.abs(density - currentDensity) <= TERRAIN_CONFORM_DENSITY_EPSILON) continue;
        const delta: { x: number; y: number; z: number; density: number; materialSlot?: number } = {
          x,
          y,
          z,
          density,
        };
        if (density > currentDensity && density >= 0) delta.materialSlot = edit.materialSlot;
        deltas.push(delta);
        const chunk = voxelChunkKeyFor(x, y, z);
        dirtyChunks.set(voxelChunkKeyString(chunk), chunk);
      }
    }
  }
  return {
    id: ++editIdCounter,
    source: "construction-terrain-conform",
    revisionBase: voxelEditStore.revision(),
    deltas,
    previousValues: transactionPreviousValues(deltas),
    dirtyChunks: [...dirtyChunks.values()],
    dirtyBounds: bounds,
    affectedMaterialSlots: deltas.some((delta) => delta.materialSlot !== undefined) ? [edit.materialSlot] : [],
  };
}

export function canUndoVoxelTransaction(transaction: VoxelEditTransaction): boolean {
  return transaction.deltas.every((delta) => {
    const current = voxelEditStore.voxelAt(delta.x, delta.y, delta.z);
    return current !== undefined
      && Math.abs(current.density - delta.density) <= TERRAIN_CONFORM_DENSITY_EPSILON
      && current.materialSlot === delta.materialSlot;
  });
}

export function voxelInverseTransaction(transaction: VoxelEditTransaction): VoxelEditTransaction {
  if (!canUndoVoxelTransaction(transaction)) {
    throw new Error("terrain changed after construction placement");
  }
  const deltas = transaction.previousValues.map((previous) => ({
    x: previous.x,
    y: previous.y,
    z: previous.z,
    density: previous.value?.density ?? proceduralDensity(previous.x, previous.y, previous.z),
    materialSlot: previous.value?.materialSlot,
  }));
  return {
    id: ++editIdCounter,
    source: "construction-terrain-undo",
    revisionBase: voxelEditStore.revision(),
    deltas,
    previousValues: transactionPreviousValues(deltas),
    dirtyChunks: transaction.dirtyChunks.map((chunk) => ({ ...chunk })),
    dirtyBounds: { ...transaction.dirtyBounds },
    affectedMaterialSlots: [...new Set(deltas.flatMap((delta) => delta.materialSlot === undefined ? [] : [delta.materialSlot]))],
  };
}

export function applyDigEditTransaction(transaction: VoxelEditTransaction, edit?: DigEdit): void {
  if (transaction.deltas.length === 0) return;
  voxelEditStore.apply(transaction);
  if (edit) brushHistory.push({ id: transaction.id, edit: { ...edit } });
  else voxelHistoryComplete = false;
  digEditRevision++;
}

export function rollbackDigEditTransaction(transaction: VoxelEditTransaction): void {
  if (transaction.deltas.length === 0) return;
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

export function getVoxelEditRevision(): number {
  return voxelEditStore.revision();
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
