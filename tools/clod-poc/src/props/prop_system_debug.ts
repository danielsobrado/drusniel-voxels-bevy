import type * as THREE from "three";
import type { PropGridCell } from "./prop_spatial_grid.js";
import type { CustomPropsSettings } from "./prop_types.js";

export interface PropSystemDebugPayload {
  settings: CustomPropsSettings["debug"];
  visibleCells: PropGridCell[];
  culledCells: PropGridCell[];
  instanceBounds: { min: THREE.Vector3; max: THREE.Vector3; lod: number }[];
}

export function collectPropDebugCells(input: {
  settings: CustomPropsSettings;
  cells: Iterable<PropGridCell>;
  visibleCellSet: ReadonlySet<string>;
  cellKey: (coord: [number, number]) => string;
  instanceBounds: { min: THREE.Vector3; max: THREE.Vector3; lod: number }[];
}): PropSystemDebugPayload {
  const visibleCells: PropGridCell[] = [];
  const culledCells: PropGridCell[] = [];
  for (const cell of input.cells) {
    const key = input.cellKey(cell.cellCoord);
    if (input.visibleCellSet.has(key)) visibleCells.push(cell);
    else culledCells.push(cell);
  }
  return {
    settings: input.settings.debug,
    visibleCells,
    culledCells,
    instanceBounds: input.instanceBounds,
  };
}

export function emptyPropDebugPayload(settings: CustomPropsSettings): PropSystemDebugPayload {
  return { settings: settings.debug, visibleCells: [], culledCells: [], instanceBounds: [] };
}
