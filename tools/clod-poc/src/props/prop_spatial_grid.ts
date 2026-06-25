import type { PropBoundsSnapshot, PropInstance, PropSpatialCell } from "./prop_types.js";

export interface PropGridCell {
  cellCoord: [number, number];
  bounds: PropBoundsSnapshot;
  instanceIndices: number[];
}

function cellKey(coord: [number, number]): string {
  return `${coord[0]},${coord[1]}`;
}

function cellBounds(cellCoord: [number, number], cellSizeM: number): PropBoundsSnapshot {
  const minX = cellCoord[0] * cellSizeM;
  const minZ = cellCoord[1] * cellSizeM;
  const maxX = minX + cellSizeM;
  const maxZ = minZ + cellSizeM;
  const centerX = (minX + maxX) * 0.5;
  const centerZ = (minZ + maxZ) * 0.5;
  const half = cellSizeM * 0.5;
  const radius = Math.hypot(half, half);
  return {
    min: [minX, -1024, minZ],
    max: [maxX, 1024, maxZ],
    center: [centerX, 0, centerZ],
    radius,
  };
}

export class PropSpatialGrid {
  readonly cellSizeM: number;
  readonly instances: PropInstance[];
  readonly cells: Map<string, PropGridCell>;

  private constructor(cellSizeM: number, instances: PropInstance[], cells: Map<string, PropGridCell>) {
    this.cellSizeM = cellSizeM;
    this.instances = instances;
    this.cells = cells;
  }

  static fromInstances(instances: PropInstance[], cellSizeM: number): PropSpatialGrid {
    const cells = new Map<string, PropGridCell>();
    const withCells = instances.map((inst) => {
      const coord: [number, number] = inst.cellCoord ?? [
        Math.floor(inst.position[0] / cellSizeM),
        Math.floor(inst.position[2] / cellSizeM),
      ];
      return { ...inst, cellCoord: coord };
    });

    for (let i = 0; i < withCells.length; i++) {
      const inst = withCells[i]!;
      const coord = inst.cellCoord!;
      const key = cellKey(coord);
      let cell = cells.get(key);
      if (!cell) {
        cell = { cellCoord: coord, bounds: cellBounds(coord, cellSizeM), instanceIndices: [] };
        cells.set(key, cell);
      }
      cell.instanceIndices.push(i);
    }

    return new PropSpatialGrid(cellSizeM, withCells, cells);
  }

  cellAt(coord: [number, number]): PropGridCell | undefined {
    return this.cells.get(cellKey(coord));
  }

  allCells(): PropGridCell[] {
    return [...this.cells.values()];
  }

  toSpatialCells(visibleKeys: ReadonlySet<string>): PropSpatialCell[] {
    return this.allCells().map((cell) => ({
      cellCoord: cell.cellCoord,
      bounds: cell.bounds,
      propInstanceIndices: [...cell.instanceIndices],
      visibleThisFrame: visibleKeys.has(cellKey(cell.cellCoord)),
    }));
  }
}
