import { PROBE_GI_RECORD_BYTES } from "../constants.js";
import { probeGiPhysicalIndex } from "../cascade_layout.js";
import type { ProbeGiCascadeId, ProbeGiCascadeState } from "../types.js";

export interface ProbeGiGpuResources {
  readonly buffers: ReadonlyMap<ProbeGiCascadeId, GPUBuffer>;
  readonly byteSize: number;
  uploadColumn(state: ProbeGiCascadeState, worldCellX: number, worldCellZ: number): void;
  dispose(): void;
}

export function createProbeGiGpuResources(
  device: GPUDevice | null | undefined,
  cascades: readonly ProbeGiCascadeState[],
): ProbeGiGpuResources | null {
  if (!device) return null;
  const buffers = new Map<ProbeGiCascadeId, GPUBuffer>();
  let byteSize = 0;
  for (const cascade of cascades) {
    const buffer = device.createBuffer({
      label: `${cascade.config.id} probe GI records`,
      size: cascade.records.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    buffers.set(cascade.config.id, buffer);
    byteSize += cascade.records.byteLength;
  }

  return {
    buffers,
    byteSize,
    uploadColumn(state, worldCellX, worldCellZ) {
      const buffer = buffers.get(state.config.id);
      if (!buffer) throw new Error(`missing probe GI GPU buffer: ${state.config.id}`);
      for (let layer = 0; layer < state.config.dimensions[1]; layer++) {
        const probeIndex = probeGiPhysicalIndex(state.config, worldCellX, layer, worldCellZ);
        const byteOffset = probeIndex * PROBE_GI_RECORD_BYTES;
        device.queue.writeBuffer(buffer, byteOffset, state.records, byteOffset, PROBE_GI_RECORD_BYTES);
      }
    },
    dispose() {
      for (const buffer of buffers.values()) buffer.destroy();
      buffers.clear();
    },
  };
}
