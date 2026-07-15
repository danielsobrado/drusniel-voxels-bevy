import { HEIGHT_UNITS_PER_METER } from "../constants.js";
import type { ErodedMacroField, ErosionGpuInitialState } from "../types.js";
import { GPU_OUTPUT_WORDS_PER_CELL } from "./buffers.js";

export interface ErosionGpuReadback {
  readonly field: ErodedMacroField;
  readonly readbackMs: number;
}

export async function readErosionGpuOutput(
  device: GPUDevice,
  output: GPUBuffer,
  initial: ErosionGpuInitialState,
): Promise<ErosionGpuReadback> {
  const startedAt = performance.now();
  const byteLength = initial.sourceWidth * initial.sourceHeight * GPU_OUTPUT_WORDS_PER_CELL * Uint32Array.BYTES_PER_ELEMENT;
  const readback = device.createBuffer({
    label: "erosion-output-readback",
    size: byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder({ label: "erosion-output-copy" });
  encoder.copyBufferToBuffer(output, 0, readback, 0, byteLength);
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  await readback.mapAsync(GPUMapMode.READ);
  const copy = readback.getMappedRange().slice(0);
  readback.unmap();
  readback.destroy();
  const u32 = new Uint32Array(copy);
  const i32 = new Int32Array(copy);
  const count = initial.sourceWidth * initial.sourceHeight;
  const heightFixed = new Int32Array(count);
  const hardness = new Uint16Array(count);
  const sediment = new Uint32Array(count);
  const deposition = new Int32Array(count);
  for (let index = 0; index < count; index++) {
    const offset = index * GPU_OUTPUT_WORDS_PER_CELL;
    heightFixed[index] = i32[offset]!;
    hardness[index] = u32[offset + 1]! & 0xffff;
    sediment[index] = u32[offset + 2]!;
    deposition[index] = i32[offset + 3]!;
  }
  const field: ErodedMacroField = {
    width: initial.sourceWidth,
    height: initial.sourceHeight,
    cellSizeM: initial.cellSizeM,
    originX: initial.originX,
    originZ: initial.originZ,
    heightFixed,
    hardness,
    sediment,
    deposition,
    sampleHeightMeters(x, z) {
      const fx = Math.max(0, Math.min(field.width - 1, (x - field.originX) / field.cellSizeM));
      const fz = Math.max(0, Math.min(field.height - 1, (z - field.originZ) / field.cellSizeM));
      const x0 = Math.floor(fx);
      const z0 = Math.floor(fz);
      const x1 = Math.min(field.width - 1, x0 + 1);
      const z1 = Math.min(field.height - 1, z0 + 1);
      const tx = fx - x0;
      const tz = fz - z0;
      const h00 = field.heightFixed[z0 * field.width + x0]!;
      const h10 = field.heightFixed[z0 * field.width + x1]!;
      const h01 = field.heightFixed[z1 * field.width + x0]!;
      const h11 = field.heightFixed[z1 * field.width + x1]!;
      const a = h00 + (h10 - h00) * tx;
      const b = h01 + (h11 - h01) * tx;
      return (a + (b - a) * tz) / HEIGHT_UNITS_PER_METER;
    },
  };
  return { field: Object.freeze(field), readbackMs: performance.now() - startedAt };
}
