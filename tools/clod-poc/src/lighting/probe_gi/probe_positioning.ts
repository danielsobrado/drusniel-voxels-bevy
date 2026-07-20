import { PROBE_GI_FLAGS } from "./constants.js";
import { probeGiPhysicalIndex, probeGiWorldPosition } from "./cascade_layout.js";
import { relocateProbeGiPosition } from "./relocation.js";
import { readProbeGiRecord, writeProbeGiRecord } from "./record_packing.js";
import type {
  ProbeGiCascadeState,
  ProbeGiConfig,
  ProbeGiProviders,
  ProbeGiRecord,
} from "./types.js";

export interface ProbeGiPositioningStats {
  positioned: number;
  validDelta: number;
  relocatedDelta: number;
  terrainUnknownDelta: number;
  terrainUnknown: number;
}

export function createProbeGiPositioningStats(): ProbeGiPositioningStats {
  return { positioned: 0, validDelta: 0, relocatedDelta: 0, terrainUnknownDelta: 0, terrainUnknown: 0 };
}

export function positionProbeGiColumn(
  state: ProbeGiCascadeState,
  worldCellX: number,
  worldCellZ: number,
  providers: ProbeGiProviders,
  config: ProbeGiConfig,
  terrainRevision: number,
  updateFrame: number,
  stats: ProbeGiPositioningStats,
): boolean {
  const terrainX = (worldCellX + 0.5) * state.config.spacingM;
  const terrainZ = (worldCellZ + 0.5) * state.config.spacingM;
  const terrainHeight = providers.terrain.heightAt(terrainX, terrainZ, state.config.spacingM);
  let hasUnknown = terrainHeight === null;

  for (let layer = 0; layer < state.config.dimensions[1]; layer++) {
    const probeIndex = probeGiPhysicalIndex(state.config, worldCellX, layer, worldCellZ);
    const previous = readProbeGiRecord(state, probeIndex);
    stats.positioned++;
    if (terrainHeight === null) {
      stats.terrainUnknown++;
      const next = unknownTerrainRecord(terrainX, terrainZ, terrainRevision, updateFrame);
      accumulateRecordDelta(previous, next, stats);
      writeProbeGiRecord(state, probeIndex, next);
      continue;
    }

    const desired = probeGiWorldPosition(state.config, worldCellX, layer, worldCellZ, terrainHeight);
    const relocation = relocateProbeGiPosition(desired, state.config.spacingM, providers.solid, config.relocation);
    let flags = relocation.valid
      ? PROBE_GI_FLAGS.valid
      : relocation.unknown
        ? PROBE_GI_FLAGS.terrainUnknown
        : PROBE_GI_FLAGS.enclosed;
    if (relocation.relocated) flags |= PROBE_GI_FLAGS.relocated;
    if (relocation.unknown) {
      hasUnknown = true;
      stats.terrainUnknown++;
    }

    const next: ProbeGiRecord = {
      shR: [0, 0, 0, 0],
      shG: [0, 0, 0, 0],
      shB: [0, 0, 0, 0],
      positionValidity: [
        relocation.position[0],
        relocation.position[1],
        relocation.position[2],
        relocation.valid ? 1 : 0,
      ],
      normalOffset: [
        relocation.offset[0],
        relocation.offset[1],
        relocation.offset[2],
        relocation.confidence,
      ],
      revisionFlags: [terrainRevision >>> 0, 0, updateFrame >>> 0, flags >>> 0],
    };
    accumulateRecordDelta(previous, next, stats);
    writeProbeGiRecord(state, probeIndex, next);
  }
  return !hasUnknown;
}

function accumulateRecordDelta(
  previous: ProbeGiRecord,
  next: ProbeGiRecord,
  stats: ProbeGiPositioningStats,
): void {
  stats.validDelta += flag(next, PROBE_GI_FLAGS.valid) - flag(previous, PROBE_GI_FLAGS.valid);
  stats.relocatedDelta += flag(next, PROBE_GI_FLAGS.relocated) - flag(previous, PROBE_GI_FLAGS.relocated);
  stats.terrainUnknownDelta += flag(next, PROBE_GI_FLAGS.terrainUnknown) - flag(previous, PROBE_GI_FLAGS.terrainUnknown);
}

function flag(record: ProbeGiRecord, mask: number): number {
  return (record.revisionFlags[3] & mask) !== 0 ? 1 : 0;
}

function unknownTerrainRecord(
  x: number,
  z: number,
  terrainRevision: number,
  updateFrame: number,
): ProbeGiRecord {
  return {
    shR: [0, 0, 0, 0],
    shG: [0, 0, 0, 0],
    shB: [0, 0, 0, 0],
    positionValidity: [x, 0, z, 0],
    normalOffset: [0, 0, 0, 0],
    revisionFlags: [terrainRevision >>> 0, 0, updateFrame >>> 0, PROBE_GI_FLAGS.terrainUnknown >>> 0],
  };
}
