import {
  PROBE_GI_COLUMN_TAG_EMPTY,
  PROBE_GI_RECORD_BYTES,
  PROBE_GI_RECORD_WORD_STRIDE,
} from "./constants.js";
import type { ProbeGiCascadeConfig, ProbeGiCascadeState, ProbeGiOrigin } from "./types.js";

export function probeGiProbeCount(config: ProbeGiCascadeConfig): number {
  return config.dimensions[0] * config.dimensions[1] * config.dimensions[2];
}

export function createProbeGiCascadeState(config: ProbeGiCascadeConfig, origin: ProbeGiOrigin): ProbeGiCascadeState {
  const count = probeGiProbeCount(config);
  const records = new ArrayBuffer(count * PROBE_GI_RECORD_BYTES);
  const columnCount = config.dimensions[0] * config.dimensions[2];
  const columnWorldCellX = new Int32Array(columnCount);
  const columnWorldCellZ = new Int32Array(columnCount);
  columnWorldCellX.fill(PROBE_GI_COLUMN_TAG_EMPTY);
  columnWorldCellZ.fill(PROBE_GI_COLUMN_TAG_EMPTY);
  return {
    config,
    origin,
    records,
    recordFloats: new Float32Array(records),
    recordFlags: new Uint32Array(records),
    columnWorldCellX,
    columnWorldCellZ,
    generation: 0,
  };
}

export function probeGiPhysicalIndex(
  config: ProbeGiCascadeConfig,
  worldCellX: number,
  layer: number,
  worldCellZ: number,
): number {
  const [sizeX, sizeY, sizeZ] = config.dimensions;
  if (!Number.isInteger(layer) || layer < 0 || layer >= sizeY) throw new Error(`probe GI layer out of range: ${layer}`);
  const slotX = positiveModulo(worldCellX, sizeX);
  const slotZ = positiveModulo(worldCellZ, sizeZ);
  return slotX + sizeX * (layer + sizeY * slotZ);
}

export function probeGiPhysicalColumnIndex(
  config: ProbeGiCascadeConfig,
  worldCellX: number,
  worldCellZ: number,
): number {
  const [sizeX, , sizeZ] = config.dimensions;
  return positiveModulo(worldCellX, sizeX) + sizeX * positiveModulo(worldCellZ, sizeZ);
}

export function probeGiColumnMatches(
  state: ProbeGiCascadeState,
  worldCellX: number,
  worldCellZ: number,
): boolean {
  const index = probeGiPhysicalColumnIndex(state.config, worldCellX, worldCellZ);
  return state.columnWorldCellX[index] === worldCellX && state.columnWorldCellZ[index] === worldCellZ;
}

export function markProbeGiColumnPositioned(
  state: ProbeGiCascadeState,
  worldCellX: number,
  worldCellZ: number,
): void {
  const index = probeGiPhysicalColumnIndex(state.config, worldCellX, worldCellZ);
  state.columnWorldCellX[index] = worldCellX;
  state.columnWorldCellZ[index] = worldCellZ;
  state.generation++;
}

export function probeGiRecordFloatOffset(probeIndex: number): number {
  return probeIndex * PROBE_GI_RECORD_WORD_STRIDE;
}

export function probeGiRecordFlagOffset(probeIndex: number): number {
  return probeIndex * PROBE_GI_RECORD_WORD_STRIDE + 20;
}

export function probeGiWorldPosition(
  config: ProbeGiCascadeConfig,
  worldCellX: number,
  layer: number,
  worldCellZ: number,
  terrainHeightM: number,
): readonly [number, number, number] {
  return [
    (worldCellX + 0.5) * config.spacingM,
    terrainHeightM + config.layerHeightsM[layer],
    (worldCellZ + 0.5) * config.spacingM,
  ];
}

export function forEachProbeWorldCell(
  config: ProbeGiCascadeConfig,
  origin: ProbeGiOrigin,
  visit: (worldCellX: number, layer: number, worldCellZ: number) => void,
): void {
  const [sizeX, sizeY, sizeZ] = config.dimensions;
  for (let localZ = 0; localZ < sizeZ; localZ++) {
    const worldCellZ = origin.cellZ + localZ;
    for (let layer = 0; layer < sizeY; layer++) {
      for (let localX = 0; localX < sizeX; localX++) {
        visit(origin.cellX + localX, layer, worldCellZ);
      }
    }
  }
}

export function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}
