import type { PropOccluder, PropOccluderSnapshot } from "./prop_occluder_snapshot.js";
import type { PropOcclusionSettings } from "./prop_types.js";
import type { LargePropOcclusionHeightPayload } from "./large_prop_occlusion_height.js";

export interface LargePropOcclusionSample {
  valid: boolean;
  enabled: boolean;
  revision: number;
  cellSizeM: number;
  giOccupancy: number;
  giBottomY: number;
  giTopY: number;
  fogOccupancy: number;
  fogBottomY: number;
  fogTopY: number;
}

export interface LargePropOcclusionFieldStats {
  readonly activeRevision: number;
  readonly pendingRevision: number;
  readonly activeCells: number;
  readonly pendingCells: number;
  readonly pending: boolean;
  readonly processedCellsLastStep: number;
  readonly swaps: number;
}

interface CellAccumulator {
  giOccupancy: number;
  giBottomY: number;
  giTopY: number;
  fogOccupancy: number;
  fogBottomY: number;
  fogTopY: number;
}

type CellRows = Map<number, Map<number, CellAccumulator>>;

interface RasterCursor {
  readonly occluder: PropOccluder;
  readonly minCellX: number;
  readonly maxCellX: number;
  readonly minCellZ: number;
  readonly maxCellZ: number;
  cellX: number;
  cellZ: number;
}

interface PendingBuild {
  readonly snapshot: PropOccluderSnapshot;
  readonly rows: CellRows;
  cellCount: number;
  occluderIndex: number;
  cursor: RasterCursor | null;
}

const EMPTY_BOTTOM = Number.POSITIVE_INFINITY;
const EMPTY_TOP = Number.NEGATIVE_INFINITY;
const COVERAGE_EPSILON = 1e-9;

export function createLargePropOcclusionSample(): LargePropOcclusionSample {
  return {
    valid: false,
    enabled: false,
    revision: 0,
    cellSizeM: 1,
    giOccupancy: 0,
    giBottomY: 0,
    giTopY: 0,
    fogOccupancy: 0,
    fogBottomY: 0,
    fogTopY: 0,
  };
}

export class LargePropOcclusionField {
  private activeRevision = 0;
  private activeEnabled = false;
  private activeRows: CellRows = new Map();
  private activeCellCount = 0;
  private pendingBuild: PendingBuild | null = null;
  private submittedRevision = 0;
  private processedCellsLastStep = 0;
  private swaps = 0;
  private cachedHeightRevision = -1;
  private cachedHeightPayload: LargePropOcclusionHeightPayload | null = null;

  constructor(private readonly settings: PropOcclusionSettings) {}

  submit(snapshot: PropOccluderSnapshot): boolean {
    if (snapshot.revision <= this.submittedRevision) return false;
    this.submittedRevision = snapshot.revision;

    if (!snapshot.enabled || !this.settings.enabled || snapshot.occluders.length === 0) {
      this.pendingBuild = null;
      this.activeRevision = snapshot.revision;
      this.activeEnabled = snapshot.enabled && this.settings.enabled;
      this.activeRows = new Map();
      this.activeCellCount = 0;
      this.processedCellsLastStep = 0;
      this.invalidateHeightPayload();
      this.swaps += 1;
      return true;
    }

    this.pendingBuild = {
      snapshot,
      rows: new Map(),
      cellCount: 0,
      occluderIndex: 0,
      cursor: null,
    };
    this.processedCellsLastStep = 0;
    return true;
  }

  step(maxCells = this.settings.buildCellsPerFrame): boolean {
    const pending = this.pendingBuild;
    this.processedCellsLastStep = 0;
    if (!pending) return false;

    let budget = Math.max(1, Math.floor(Number.isFinite(maxCells) ? maxCells : 1));
    while (budget > 0 && this.pendingBuild === pending) {
      if (pending.occluderIndex >= pending.snapshot.occluders.length) {
        this.commitPending(pending);
        break;
      }

      pending.cursor ??= this.createCursor(pending.snapshot.occluders[pending.occluderIndex]!);
      if (this.rasterCell(pending.rows, pending.cursor)) pending.cellCount += 1;
      this.processedCellsLastStep += 1;
      budget -= 1;

      if (advanceCursor(pending.cursor)) {
        pending.occluderIndex += 1;
        pending.cursor = null;
      }
    }

    if (
      this.pendingBuild === pending
      && pending.occluderIndex >= pending.snapshot.occluders.length
      && pending.cursor === null
    ) {
      this.commitPending(pending);
    }
    return this.processedCellsLastStep > 0;
  }

  sampleInto(x: number, z: number, out: LargePropOcclusionSample): LargePropOcclusionSample {
    resetSample(out, this.activeRevision, this.activeEnabled, this.settings.cellSizeM);
    if (this.activeRevision <= 0 || !Number.isFinite(x) || !Number.isFinite(z)) return out;
    out.valid = true;
    if (!this.activeEnabled) return out;

    const cellX = Math.floor(x / this.settings.cellSizeM);
    const cellZ = Math.floor(z / this.settings.cellSizeM);
    const cell = this.activeRows.get(cellZ)?.get(cellX);
    if (!cell) return out;

    out.giOccupancy = cell.giOccupancy;
    out.giBottomY = finiteBottom(cell.giBottomY);
    out.giTopY = finiteTop(cell.giTopY);
    out.fogOccupancy = cell.fogOccupancy;
    out.fogBottomY = finiteBottom(cell.fogBottomY);
    out.fogTopY = finiteTop(cell.fogTopY);
    return out;
  }

  giHeightPayload(): LargePropOcclusionHeightPayload | null {
    if (this.cachedHeightRevision === this.activeRevision) return this.cachedHeightPayload;
    this.cachedHeightRevision = this.activeRevision;
    this.cachedHeightPayload = this.buildHeightPayload();
    return this.cachedHeightPayload;
  }

  mistClipStrength(): number {
    return this.settings.mistClipStrength;
  }

  stats(): LargePropOcclusionFieldStats {
    return {
      activeRevision: this.activeRevision,
      pendingRevision: this.pendingBuild?.snapshot.revision ?? 0,
      activeCells: this.activeCellCount,
      pendingCells: this.pendingBuild?.cellCount ?? 0,
      pending: this.pendingBuild !== null,
      processedCellsLastStep: this.processedCellsLastStep,
      swaps: this.swaps,
    };
  }

  private buildHeightPayload(): LargePropOcclusionHeightPayload | null {
    if (!this.activeEnabled || this.activeRevision <= 0 || this.activeCellCount === 0) return null;

    let count = 0;
    for (const row of this.activeRows.values()) {
      for (const cell of row.values()) {
        if (cell.giOccupancy > COVERAGE_EPSILON && Number.isFinite(cell.giTopY)) count += 1;
      }
    }
    if (count === 0) return null;

    const cellX = new Int32Array(count);
    const cellZ = new Int32Array(count);
    const topY = new Float32Array(count);
    let minX = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    let index = 0;
    const cellSize = this.settings.cellSizeM;
    for (const [z, row] of this.activeRows) {
      for (const [x, cell] of row) {
        if (cell.giOccupancy <= COVERAGE_EPSILON || !Number.isFinite(cell.giTopY)) continue;
        cellX[index] = x;
        cellZ[index] = z;
        topY[index] = cell.giTopY;
        minX = Math.min(minX, x * cellSize);
        minZ = Math.min(minZ, z * cellSize);
        maxX = Math.max(maxX, (x + 1) * cellSize);
        maxZ = Math.max(maxZ, (z + 1) * cellSize);
        index += 1;
      }
    }

    return {
      revision: this.activeRevision,
      cellSizeM: cellSize,
      cellX,
      cellZ,
      topY,
      minX,
      minZ,
      maxX,
      maxZ,
    };
  }

  private createCursor(occluder: PropOccluder): RasterCursor {
    const cellSize = this.settings.cellSizeM;
    const minCellX = Math.floor(occluder.bounds.minX / cellSize);
    const maxCellX = Math.max(minCellX, Math.ceil(occluder.bounds.maxX / cellSize) - 1);
    const minCellZ = Math.floor(occluder.bounds.minZ / cellSize);
    const maxCellZ = Math.max(minCellZ, Math.ceil(occluder.bounds.maxZ / cellSize) - 1);
    return {
      occluder,
      minCellX,
      maxCellX,
      minCellZ,
      maxCellZ,
      cellX: minCellX,
      cellZ: minCellZ,
    };
  }

  private rasterCell(rows: CellRows, cursor: RasterCursor): boolean {
    const cellSize = this.settings.cellSizeM;
    const cellMinX = cursor.cellX * cellSize;
    const cellMinZ = cursor.cellZ * cellSize;
    const bounds = cursor.occluder.bounds;
    const overlapX = Math.max(0, Math.min(bounds.maxX, cellMinX + cellSize) - Math.max(bounds.minX, cellMinX));
    const overlapZ = Math.max(0, Math.min(bounds.maxZ, cellMinZ + cellSize) - Math.max(bounds.minZ, cellMinZ));
    const coverage = clamp01((overlapX * overlapZ) / (cellSize * cellSize));
    if (coverage <= COVERAGE_EPSILON) return false;

    let row = rows.get(cursor.cellZ);
    if (!row) {
      row = new Map();
      rows.set(cursor.cellZ, row);
    }
    let cell = row.get(cursor.cellX);
    const created = cell === undefined;
    if (!cell) {
      cell = emptyCell();
      row.set(cursor.cellX, cell);
    }
    if (cursor.occluder.affectGi) {
      cell.giOccupancy = unionCoverage(cell.giOccupancy, coverage);
      cell.giBottomY = Math.min(cell.giBottomY, bounds.minY);
      cell.giTopY = Math.max(cell.giTopY, bounds.maxY);
    }
    if (cursor.occluder.affectFog) {
      cell.fogOccupancy = unionCoverage(cell.fogOccupancy, coverage);
      cell.fogBottomY = Math.min(cell.fogBottomY, bounds.minY);
      cell.fogTopY = Math.max(cell.fogTopY, bounds.maxY);
    }
    return created;
  }

  private commitPending(pending: PendingBuild): void {
    if (this.pendingBuild !== pending) return;
    this.activeRevision = pending.snapshot.revision;
    this.activeEnabled = pending.snapshot.enabled && this.settings.enabled;
    this.activeRows = pending.rows;
    this.activeCellCount = pending.cellCount;
    this.pendingBuild = null;
    this.invalidateHeightPayload();
    this.swaps += 1;
  }

  private invalidateHeightPayload(): void {
    this.cachedHeightRevision = -1;
    this.cachedHeightPayload = null;
  }
}

function advanceCursor(cursor: RasterCursor): boolean {
  cursor.cellX += 1;
  if (cursor.cellX <= cursor.maxCellX) return false;
  cursor.cellX = cursor.minCellX;
  cursor.cellZ += 1;
  return cursor.cellZ > cursor.maxCellZ;
}

function emptyCell(): CellAccumulator {
  return {
    giOccupancy: 0,
    giBottomY: EMPTY_BOTTOM,
    giTopY: EMPTY_TOP,
    fogOccupancy: 0,
    fogBottomY: EMPTY_BOTTOM,
    fogTopY: EMPTY_TOP,
  };
}

function resetSample(
  out: LargePropOcclusionSample,
  revision: number,
  enabled: boolean,
  cellSizeM: number,
): void {
  out.valid = false;
  out.enabled = enabled;
  out.revision = revision;
  out.cellSizeM = cellSizeM;
  out.giOccupancy = 0;
  out.giBottomY = 0;
  out.giTopY = 0;
  out.fogOccupancy = 0;
  out.fogBottomY = 0;
  out.fogTopY = 0;
}

function unionCoverage(current: number, next: number): number {
  return clamp01(1 - (1 - current) * (1 - next));
}

function finiteBottom(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function finiteTop(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
