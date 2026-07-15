import { EROSION_SCHEMA_VERSION } from "./constants.js";
import { cloneErosionState } from "./state.js";
import type { ErosionCpuCheckpoint, ErosionGpuCheckpoint, ErosionState } from "./types.js";

const GPU_CHECKPOINT_WORDS_PER_CELL = 8;

export function createErosionCheckpoint(
  state: ErosionState,
  sourceTerrainHash: string,
  configHash: string,
): ErosionCpuCheckpoint {
  return Object.freeze({
    kind: "cpu",
    schemaVersion: EROSION_SCHEMA_VERSION,
    sourceTerrainHash,
    configHash,
    hydraulicIteration: state.hydraulicIteration,
    thermalIteration: state.thermalIteration,
    state: cloneErosionState(state),
  });
}

export function restoreErosionCheckpoint(
  checkpoint: ErosionCpuCheckpoint,
  sourceTerrainHash: string,
  configHash: string,
): ErosionState {
  if (checkpoint.kind && checkpoint.kind !== "cpu") throw new Error("erosion CPU checkpoint kind mismatch");
  if (checkpoint.schemaVersion !== EROSION_SCHEMA_VERSION) throw new Error("erosion checkpoint schema mismatch");
  if (checkpoint.sourceTerrainHash !== sourceTerrainHash) throw new Error("erosion checkpoint terrain hash mismatch");
  if (checkpoint.configHash !== configHash) throw new Error("erosion checkpoint config hash mismatch");
  if (checkpoint.hydraulicIteration !== checkpoint.state.hydraulicIteration
    || checkpoint.thermalIteration !== checkpoint.state.thermalIteration) {
    throw new Error("erosion checkpoint iteration metadata is corrupt");
  }
  return cloneErosionState(checkpoint.state);
}

export function validateErosionGpuCheckpoint(
  checkpoint: ErosionGpuCheckpoint,
  sourceTerrainHash: string,
  configHash: string,
): ErosionGpuCheckpoint {
  if (checkpoint.kind !== "gpu") throw new Error("erosion GPU checkpoint kind mismatch");
  if (checkpoint.schemaVersion !== EROSION_SCHEMA_VERSION) throw new Error("erosion GPU checkpoint schema mismatch");
  if (checkpoint.sourceTerrainHash !== sourceTerrainHash) throw new Error("erosion GPU checkpoint terrain hash mismatch");
  if (checkpoint.configHash !== configHash) throw new Error("erosion GPU checkpoint config hash mismatch");
  const cellCount = checkpoint.initial.width * checkpoint.initial.height;
  if (!Number.isSafeInteger(cellCount) || cellCount <= 0) throw new Error("erosion GPU checkpoint dimensions are invalid");
  const expectedBytes = cellCount * GPU_CHECKPOINT_WORDS_PER_CELL * Uint32Array.BYTES_PER_ELEMENT;
  if (checkpoint.packedByteLength !== expectedBytes) {
    throw new Error("erosion GPU checkpoint byte length mismatch");
  }
  const packedBytes = checkpoint.packedChunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  if (packedBytes !== checkpoint.packedByteLength) {
    throw new Error("erosion GPU checkpoint chunks are incomplete");
  }
  return checkpoint;
}

export function collectErosionCheckpointTransferables(checkpoint: ErosionCpuCheckpoint): Transferable[] {
  const state = checkpoint.state;
  return [
    state.heightFixed.buffer,
    state.hardness.buffer,
    state.water.buffer,
    state.sediment.buffer,
    state.sedimentScratch.buffer,
    state.deposition.buffer,
    state.fluxLeft.buffer,
    state.fluxRight.buffer,
    state.fluxUp.buffer,
    state.fluxDown.buffer,
    state.velocityX.buffer,
    state.velocityZ.buffer,
    state.capacity.buffer,
    state.thermalDelta.buffer,
  ];
}

export function collectErosionGpuCheckpointTransferables(checkpoint: ErosionGpuCheckpoint): Transferable[] {
  return [...checkpoint.packedChunks];
}
