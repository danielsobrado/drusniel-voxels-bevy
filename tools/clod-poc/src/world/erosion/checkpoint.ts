import { EROSION_SCHEMA_VERSION } from "./constants.js";
import { cloneErosionState } from "./state.js";
import type { ErosionCheckpoint, ErosionState } from "./types.js";

export function createErosionCheckpoint(
  state: ErosionState,
  sourceTerrainHash: string,
  configHash: string,
): ErosionCheckpoint {
  return Object.freeze({
    schemaVersion: EROSION_SCHEMA_VERSION,
    sourceTerrainHash,
    configHash,
    hydraulicIteration: state.hydraulicIteration,
    thermalIteration: state.thermalIteration,
    state: cloneErosionState(state),
  });
}

export function restoreErosionCheckpoint(
  checkpoint: ErosionCheckpoint,
  sourceTerrainHash: string,
  configHash: string,
): ErosionState {
  if (checkpoint.schemaVersion !== EROSION_SCHEMA_VERSION) throw new Error("erosion checkpoint schema mismatch");
  if (checkpoint.sourceTerrainHash !== sourceTerrainHash) throw new Error("erosion checkpoint terrain hash mismatch");
  if (checkpoint.configHash !== configHash) throw new Error("erosion checkpoint config hash mismatch");
  if (checkpoint.hydraulicIteration !== checkpoint.state.hydraulicIteration
    || checkpoint.thermalIteration !== checkpoint.state.thermalIteration) {
    throw new Error("erosion checkpoint iteration metadata is corrupt");
  }
  return cloneErosionState(checkpoint.state);
}

export function collectErosionCheckpointTransferables(checkpoint: ErosionCheckpoint): Transferable[] {
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
