import { describe, expect, it } from "vitest";
import configText from "../../../config/probe_gi.yaml?raw";
import { createProbeGiCascadeState } from "./cascade_layout.js";
import { probeGiOriginForCamera } from "./clipmap_origin.js";
import { parseProbeGiConfig } from "./config.js";
import { PROBE_GI_RECORD_BYTES } from "./constants.js";
import { readProbeGiRecord, validateProbeGiRecordLayout, writeProbeGiRecord } from "./record_packing.js";

const first = {
  shR: [1, 2, 3, 4] as const,
  shG: [5, 6, 7, 8] as const,
  shB: [9, 10, 11, 12] as const,
  positionValidity: [13, 14, 15, 1] as const,
  normalOffset: [0.1, 0.2, 0.3, 0.9] as const,
  revisionFlags: [21, 22, 23, 24] as const,
};
const second = {
  shR: [31, 32, 33, 34] as const,
  shG: [35, 36, 37, 38] as const,
  shB: [39, 40, 41, 42] as const,
  positionValidity: [43, 44, 45, 1] as const,
  normalOffset: [0.4, 0.5, 0.6, 0.8] as const,
  revisionFlags: [51, 52, 53, 54] as const,
};

describe("probe GI record packing", () => {
  it("matches the 96-byte WGSL layout without adjacent-record overlap", () => {
    validateProbeGiRecordLayout();
    const cascade = parseProbeGiConfig(configText).cascades[0];
    const state = createProbeGiCascadeState(cascade, probeGiOriginForCamera(0, 0, cascade));
    expect(state.records.byteLength).toBe(8192 * PROBE_GI_RECORD_BYTES);
    writeProbeGiRecord(state, 17, first);
    writeProbeGiRecord(state, 18, second);
    expect(readProbeGiRecord(state, 17)).toEqual(f32Record(first));
    expect(readProbeGiRecord(state, 18)).toEqual(f32Record(second));
  });
});

function f32Record<T extends typeof first | typeof second>(record: T) {
  const round = (values: readonly number[]) => values.map(Math.fround);
  return {
    ...record,
    shR: round(record.shR),
    shG: round(record.shG),
    shB: round(record.shB),
    positionValidity: round(record.positionValidity),
    normalOffset: round(record.normalOffset),
  };
}
