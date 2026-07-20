import {
  PROBE_GI_DIMENSIONS,
  PROBE_GI_PROBES_PER_CASCADE,
  PROBE_GI_RECORD_BYTES,
  PROBE_GI_TOTAL_PROBES,
} from "./constants.js";
import { probeGiProbeCount } from "./cascade_layout.js";
import type { ProbeGiConfig } from "./types.js";

const MAXIMUM_STORAGE_BYTES = 16 * 1024 * 1024;

export function validateProbeGiStartup(config: ProbeGiConfig, storageBytes: number): void {
  if (config.cascades.length !== 3) throw new Error("probe GI requires exactly three cascades");
  for (const cascade of config.cascades) {
    if (cascade.dimensions.some((value, axis) => value !== PROBE_GI_DIMENSIONS[axis])) {
      throw new Error(`${cascade.id} probe GI dimensions do not match the fixed architecture`);
    }
    if (probeGiProbeCount(cascade) !== PROBE_GI_PROBES_PER_CASCADE) {
      throw new Error(`${cascade.id} probe GI count must be ${PROBE_GI_PROBES_PER_CASCADE}`);
    }
  }
  const recordBytes = PROBE_GI_TOTAL_PROBES * PROBE_GI_RECORD_BYTES;
  if (recordBytes !== 2_359_296) throw new Error(`probe GI record storage mismatch: ${recordBytes}`);
  if (storageBytes > MAXIMUM_STORAGE_BYTES) {
    throw new Error(`probe GI storage exceeds 16 MiB: ${storageBytes}`);
  }
}
