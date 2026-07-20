import { positiveModulo } from "./cascade_layout.js";
import type { ProbeGiCascadeConfig, ProbeGiOrigin } from "./types.js";

export function probeGiOriginForCamera(
  cameraX: number,
  cameraZ: number,
  config: ProbeGiCascadeConfig,
): ProbeGiOrigin {
  assertFinite(cameraX, "cameraX");
  assertFinite(cameraZ, "cameraZ");
  const [sizeX, , sizeZ] = config.dimensions;
  const centerCellX = Math.floor(cameraX / config.spacingM);
  const centerCellZ = Math.floor(cameraZ / config.spacingM);
  const cellX = centerCellX - Math.floor(sizeX / 2);
  const cellZ = centerCellZ - Math.floor(sizeZ / 2);
  return {
    cellX,
    cellZ,
    worldX: cellX * config.spacingM,
    worldZ: cellZ * config.spacingM,
    slotX: positiveModulo(cellX, sizeX),
    slotZ: positiveModulo(cellZ, sizeZ),
  };
}

export function probeGiOriginEqual(a: ProbeGiOrigin, b: ProbeGiOrigin): boolean {
  return a.cellX === b.cellX && a.cellZ === b.cellZ;
}

export interface ProbeGiExposedColumn {
  readonly worldCellX: number;
  readonly worldCellZ: number;
}

export function probeGiExposedColumns(
  config: ProbeGiCascadeConfig,
  previous: ProbeGiOrigin | null,
  next: ProbeGiOrigin,
): ProbeGiExposedColumn[] {
  const [sizeX, , sizeZ] = config.dimensions;
  if (!previous) return allColumns(sizeX, sizeZ, next);
  const deltaX = next.cellX - previous.cellX;
  const deltaZ = next.cellZ - previous.cellZ;
  if (Math.abs(deltaX) >= sizeX || Math.abs(deltaZ) >= sizeZ) return allColumns(sizeX, sizeZ, next);

  const columns: ProbeGiExposedColumn[] = [];
  const seen = new Set<string>();
  for (let localZ = 0; localZ < sizeZ; localZ++) {
    const worldCellZ = next.cellZ + localZ;
    for (let localX = 0; localX < sizeX; localX++) {
      const worldCellX = next.cellX + localX;
      const insidePrevious = worldCellX >= previous.cellX
        && worldCellX < previous.cellX + sizeX
        && worldCellZ >= previous.cellZ
        && worldCellZ < previous.cellZ + sizeZ;
      if (insidePrevious) continue;
      const key = `${worldCellX},${worldCellZ}`;
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push({ worldCellX, worldCellZ });
    }
  }
  return columns;
}

function allColumns(sizeX: number, sizeZ: number, origin: ProbeGiOrigin): ProbeGiExposedColumn[] {
  const columns: ProbeGiExposedColumn[] = [];
  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      columns.push({ worldCellX: origin.cellX + x, worldCellZ: origin.cellZ + z });
    }
  }
  return columns;
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}
