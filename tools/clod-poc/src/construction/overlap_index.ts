import { constructionBoundsFor, type ConstructionBounds3d } from "./construction_bounds.js";
import type { ConstructionPieceDef, PlacedConstructionPiece } from "./types.js";

const MIN_CELL_SIZE_M = 0.1;
const DEFAULT_CELL_SIZE_M = 4;

interface IndexedPiece {
  placed: PlacedConstructionPiece;
  occupiedCells: readonly string[];
}

export interface ConstructionOverlapQueryStats {
  visitedCells: number;
  candidatePieces: number;
}

export class ConstructionOverlapIndex {
  private readonly cells = new Map<string, Set<string>>();
  private readonly pieces = new Map<string, IndexedPiece>();
  private lastQuery: ConstructionOverlapQueryStats = { visitedCells: 0, candidatePieces: 0 };

  constructor(private readonly cellSizeM = DEFAULT_CELL_SIZE_M) {}

  addPiece(placed: PlacedConstructionPiece, definition: ConstructionPieceDef): void {
    this.removeEntity(placed.id);
    const occupiedCells = this.cellKeysForBounds(constructionBoundsFor(
      definition,
      placed.position,
      placed.rotationQuarterTurns,
    ));
    this.pieces.set(placed.id, { placed, occupiedCells });
    for (const key of occupiedCells) {
      const ids = this.cells.get(key) ?? new Set<string>();
      ids.add(placed.id);
      this.cells.set(key, ids);
    }
  }

  removeEntity(entityId: string): void {
    const indexed = this.pieces.get(entityId);
    if (!indexed) return;
    for (const key of indexed.occupiedCells) {
      const ids = this.cells.get(key);
      if (!ids) continue;
      ids.delete(entityId);
      if (ids.size === 0) this.cells.delete(key);
    }
    this.pieces.delete(entityId);
  }

  query(
    piece: ConstructionPieceDef,
    position: readonly [number, number, number],
    rotationQuarterTurns: number,
  ): PlacedConstructionPiece[] {
    const ids = new Set<string>();
    const keys = this.cellKeysForBounds(constructionBoundsFor(piece, position, rotationQuarterTurns));
    for (const key of keys) {
      const cell = this.cells.get(key);
      if (!cell) continue;
      for (const id of cell) ids.add(id);
    }
    const result: PlacedConstructionPiece[] = [];
    for (const id of ids) {
      const placed = this.pieces.get(id)?.placed;
      if (placed) result.push(placed);
    }
    this.lastQuery = { visitedCells: keys.length, candidatePieces: result.length };
    return result;
  }

  size(): number {
    return this.pieces.size;
  }

  cellCount(): number {
    return this.cells.size;
  }

  queryStats(): ConstructionOverlapQueryStats {
    return { ...this.lastQuery };
  }

  private cellKeysForBounds(bounds: ConstructionBounds3d): string[] {
    const cell = this.safeCellSize();
    const minX = Math.floor(bounds.minX / cell);
    const maxX = Math.floor(bounds.maxX / cell);
    const minY = Math.floor(bounds.minY / cell);
    const maxY = Math.floor(bounds.maxY / cell);
    const minZ = Math.floor(bounds.minZ / cell);
    const maxZ = Math.floor(bounds.maxZ / cell);
    const result: string[] = [];
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) result.push(`${x},${y},${z}`);
      }
    }
    return result;
  }

  private safeCellSize(): number {
    return Math.max(MIN_CELL_SIZE_M, this.cellSizeM);
  }
}
