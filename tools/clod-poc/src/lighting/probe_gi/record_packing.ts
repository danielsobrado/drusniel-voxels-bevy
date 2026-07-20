import {
  PROBE_GI_RECORD_BYTES,
  PROBE_GI_RECORD_FLOAT_COMPONENTS,
  PROBE_GI_RECORD_U32_COMPONENTS,
  PROBE_GI_RECORD_WORD_STRIDE,
} from "./constants.js";
import { probeGiRecordFlagOffset, probeGiRecordFloatOffset } from "./cascade_layout.js";
import type { ProbeGiCascadeState, ProbeGiRecord, ProbeGiUvec4, ProbeGiVec4 } from "./types.js";

const ZERO_VEC4: ProbeGiVec4 = [0, 0, 0, 0];
const ZERO_UVEC4: ProbeGiUvec4 = [0, 0, 0, 0];

export function emptyProbeGiRecord(): ProbeGiRecord {
  return {
    shR: ZERO_VEC4,
    shG: ZERO_VEC4,
    shB: ZERO_VEC4,
    positionValidity: ZERO_VEC4,
    normalOffset: ZERO_VEC4,
    revisionFlags: ZERO_UVEC4,
  };
}

export function writeProbeGiRecord(state: ProbeGiCascadeState, probeIndex: number, record: ProbeGiRecord): void {
  assertProbeIndex(state, probeIndex);
  const floatOffset = probeGiRecordFloatOffset(probeIndex);
  writeVec4(state.recordFloats, floatOffset, record.shR);
  writeVec4(state.recordFloats, floatOffset + 4, record.shG);
  writeVec4(state.recordFloats, floatOffset + 8, record.shB);
  writeVec4(state.recordFloats, floatOffset + 12, record.positionValidity);
  writeVec4(state.recordFloats, floatOffset + 16, record.normalOffset);
  const flagOffset = probeGiRecordFlagOffset(probeIndex);
  state.recordFlags.set(record.revisionFlags, flagOffset);
}

export function readProbeGiRecord(state: ProbeGiCascadeState, probeIndex: number): ProbeGiRecord {
  assertProbeIndex(state, probeIndex);
  const floatOffset = probeGiRecordFloatOffset(probeIndex);
  const flagOffset = probeGiRecordFlagOffset(probeIndex);
  return {
    shR: readVec4(state.recordFloats, floatOffset),
    shG: readVec4(state.recordFloats, floatOffset + 4),
    shB: readVec4(state.recordFloats, floatOffset + 8),
    positionValidity: readVec4(state.recordFloats, floatOffset + 12),
    normalOffset: readVec4(state.recordFloats, floatOffset + 16),
    revisionFlags: [
      state.recordFlags[flagOffset] ?? 0,
      state.recordFlags[flagOffset + 1] ?? 0,
      state.recordFlags[flagOffset + 2] ?? 0,
      state.recordFlags[flagOffset + 3] ?? 0,
    ],
  };
}

export function validateProbeGiRecordLayout(): void {
  const payloadWords = PROBE_GI_RECORD_FLOAT_COMPONENTS + PROBE_GI_RECORD_U32_COMPONENTS;
  if (payloadWords !== PROBE_GI_RECORD_WORD_STRIDE || PROBE_GI_RECORD_WORD_STRIDE * Uint32Array.BYTES_PER_ELEMENT !== PROBE_GI_RECORD_BYTES) {
    throw new Error("probe GI record layout is not 96 bytes");
  }
}

function writeVec4(target: Float32Array, offset: number, value: ProbeGiVec4): void {
  target[offset] = value[0];
  target[offset + 1] = value[1];
  target[offset + 2] = value[2];
  target[offset + 3] = value[3];
}

function readVec4(source: Float32Array, offset: number): ProbeGiVec4 {
  return [source[offset] ?? 0, source[offset + 1] ?? 0, source[offset + 2] ?? 0, source[offset + 3] ?? 0];
}

function assertProbeIndex(state: ProbeGiCascadeState, probeIndex: number): void {
  const count = state.records.byteLength / PROBE_GI_RECORD_BYTES;
  if (!Number.isInteger(probeIndex) || probeIndex < 0 || probeIndex >= count) {
    throw new Error(`probe GI index out of range: ${probeIndex}`);
  }
}
