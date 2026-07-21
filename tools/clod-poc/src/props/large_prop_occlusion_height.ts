export interface LargePropOcclusionHeightPayload {
  readonly revision: number;
  readonly cellSizeM: number;
  readonly cellX: Int32Array;
  readonly cellZ: Int32Array;
  readonly topY: Float32Array;
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

export interface LargePropOcclusionRegion {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

export function cloneLargePropOcclusionHeightPayload(
  payload: LargePropOcclusionHeightPayload,
): LargePropOcclusionHeightPayload {
  return {
    revision: payload.revision,
    cellSizeM: payload.cellSizeM,
    cellX: payload.cellX.slice(),
    cellZ: payload.cellZ.slice(),
    topY: payload.topY.slice(),
    minX: payload.minX,
    minZ: payload.minZ,
    maxX: payload.maxX,
    maxZ: payload.maxZ,
  };
}

export function largePropOcclusionPayloadRegion(
  payload: LargePropOcclusionHeightPayload | null,
): LargePropOcclusionRegion | null {
  if (!payload || payload.cellX.length === 0) return null;
  return {
    minX: payload.minX,
    minZ: payload.minZ,
    maxX: payload.maxX,
    maxZ: payload.maxZ,
  };
}

export function createLargePropOcclusionHeightSampler(
  payload: LargePropOcclusionHeightPayload | null,
  fallback: (x: number, z: number) => number,
): (x: number, z: number) => number {
  if (!payload || !validPayload(payload) || payload.cellX.length === 0) return fallback;

  const rows = new Map<number, Map<number, number>>();
  for (let index = 0; index < payload.cellX.length; index += 1) {
    const x = payload.cellX[index]!;
    const z = payload.cellZ[index]!;
    const topY = payload.topY[index]!;
    let row = rows.get(z);
    if (!row) {
      row = new Map();
      rows.set(z, row);
    }
    row.set(x, Math.max(row.get(x) ?? Number.NEGATIVE_INFINITY, topY));
  }

  const cellSize = payload.cellSizeM;
  return (x: number, z: number): number => {
    const terrainHeight = fallback(x, z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return terrainHeight;
    const cellX = Math.floor(x / cellSize);
    const cellZ = Math.floor(z / cellSize);
    const propTop = rows.get(cellZ)?.get(cellX);
    return propTop === undefined || Number.isNaN(terrainHeight)
      ? propTop ?? terrainHeight
      : Math.max(terrainHeight, propTop);
  };
}

function validPayload(payload: LargePropOcclusionHeightPayload): boolean {
  const count = payload.cellX.length;
  return Number.isFinite(payload.revision)
    && Number.isFinite(payload.cellSizeM)
    && payload.cellSizeM > 0
    && payload.cellZ.length === count
    && payload.topY.length === count;
}
