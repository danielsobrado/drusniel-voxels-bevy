import {
  HYDROLOGY_BODY_LAKE,
  HYDROLOGY_BODY_MARSH,
  HYDROLOGY_BODY_OCEAN,
  HYDROLOGY_BODY_POND,
  HYDROLOGY_BODY_RIVER,
  gridIndex,
  sampleArrayAtGrid,
  worldToGrid,
  type HydrologyGrid,
} from "./hydrologyGrid.js";

export type GeneratedWaterBodyKind = "Ocean" | "LakeBasin" | "RiverChannel" | "Pond" | "CaveWaterAquifer" | "None";

export interface VisualHydrologyMetadata {
  resolution: number;
  farResolution: number;
  worldMin: [number, number];
  worldSize: [number, number];
  cellSize: [number, number];
}

export interface VisualHydrologySample {
  waterY: number;
  wetMask: number;
  flowDirSpeed: [number, number];
  flowStrength: number;
  riverDepth: number;
  moisture: number;
  bodyKind: GeneratedWaterBodyKind;
}

export interface VisualHydrologyField {
  waterY: Float32Array;
  waterYFar: Float32Array;
  wetMask: Uint8Array;
  flowDirSpeed: Float32Array;
  flowStrength: Float32Array;
  riverDepth: Float32Array;
  moisture: Float32Array;
  bodyKind: GeneratedWaterBodyKind[];
  metadata: VisualHydrologyMetadata;
}

export interface VisualHydrologyFieldConfig {
  farReduceFactor: number;
  moistureBlurRadius: number;
}

export const DEFAULT_VISUAL_HYDROLOGY_FIELD_CONFIG: VisualHydrologyFieldConfig = {
  farReduceFactor: 8,
  moistureBlurRadius: 4,
};

export function buildVisualHydrologyField(
  grid: HydrologyGrid,
  config: Partial<VisualHydrologyFieldConfig> = {},
): VisualHydrologyField {
  const resolved = { ...DEFAULT_VISUAL_HYDROLOGY_FIELD_CONFIG, ...config };
  const res = Math.max(1, grid.res);
  const farResolution = grid.farRes || Math.max(1, Math.floor(res / Math.max(1, Math.floor(resolved.farReduceFactor))));
  const count = res * res;
  const waterY = new Float32Array(grid.waterY);
  const wetMask = new Uint8Array(count);
  const flowDirSpeed = new Float32Array(count * 2);
  const flowStrength = new Float32Array(grid.flowStrength);
  const riverDepth = new Float32Array(grid.riverDepth);
  const bodyKind = new Array<GeneratedWaterBodyKind>(count);

  for (let i = 0; i < count; i++) {
    const wet = grid.wetMask[i] > 0.5;
    wetMask[i] = wet ? 255 : 0;
    flowDirSpeed[i * 2] = grid.flowDirX[i] * grid.flowStrength[i];
    flowDirSpeed[i * 2 + 1] = grid.flowDirZ[i] * grid.flowStrength[i];
    bodyKind[i] = visualBodyKindLabel(grid.bodyKind[i]);
  }

  return {
    waterY,
    waterYFar: new Float32Array(grid.waterYFar),
    wetMask,
    flowDirSpeed,
    flowStrength,
    riverDepth,
    moisture: new Float32Array(grid.moisture),
    bodyKind,
    metadata: {
      resolution: res,
      farResolution,
      worldMin: [0, 0],
      worldSize: [grid.worldCells, grid.worldCells],
      cellSize: [grid.texel, grid.texel],
    },
  };
}

export function sampleVisualHydrologyField(field: VisualHydrologyField, x: number, z: number): VisualHydrologySample {
  const gridLike = {
    res: field.metadata.resolution,
    worldCells: field.metadata.worldSize[0],
  } as HydrologyGrid;
  const { gx, gz } = worldToGrid(gridLike, x - field.metadata.worldMin[0], z - field.metadata.worldMin[1]);
  const nearestX = Math.max(0, Math.min(field.metadata.resolution - 1, Math.round(gx)));
  const nearestZ = Math.max(0, Math.min(field.metadata.resolution - 1, Math.round(gz)));
  const nearest = gridIndex(field.metadata.resolution, nearestX, nearestZ);
  return {
    waterY: sampleArrayAtGrid(field.waterY, field.metadata.resolution, gx, gz),
    wetMask: field.wetMask[nearest] / 255,
    flowDirSpeed: [field.flowDirSpeed[nearest * 2], field.flowDirSpeed[nearest * 2 + 1]],
    flowStrength: sampleArrayAtGrid(field.flowStrength, field.metadata.resolution, gx, gz),
    riverDepth: sampleArrayAtGrid(field.riverDepth, field.metadata.resolution, gx, gz),
    moisture: sampleArrayAtGrid(field.moisture, field.metadata.resolution, gx, gz),
    bodyKind: field.bodyKind[nearest],
  };
}

function visualBodyKindLabel(kind: number): GeneratedWaterBodyKind {
  if (kind === HYDROLOGY_BODY_OCEAN) return "Ocean";
  if (kind === HYDROLOGY_BODY_LAKE) return "LakeBasin";
  if (kind === HYDROLOGY_BODY_RIVER) return "RiverChannel";
  if (kind === HYDROLOGY_BODY_POND) return "Pond";
  if (kind === HYDROLOGY_BODY_MARSH) return "Pond";
  return "None";
}
