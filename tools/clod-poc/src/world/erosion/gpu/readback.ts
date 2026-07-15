import { assertErosionNotAborted, yieldErosionTask } from "../abort.js";
import { EROSION_READBACK_CHUNK_BYTES, EROSION_SCHEMA_VERSION } from "../constants.js";
import type { ErosionGpuCheckpoint, ErosionGpuInitialState } from "../types.js";
import type { ErosionGpuBuffers } from "./buffers.js";
import { GPU_OUTPUT_WORDS_PER_CELL, GPU_STATE_A_WORDS_PER_CELL } from "./buffers.js";

export interface ErosionGpuChunkReadback {
  readonly chunks: readonly ArrayBuffer[];
  readonly byteLength: number;
  readonly readbackMs: number;
  readonly maxMainThreadSliceMs: number;
}

async function readBufferChunks(
  device: GPUDevice,
  source: GPUBuffer,
  byteLength: number,
  label: string,
  signal?: AbortSignal,
): Promise<ErosionGpuChunkReadback> {
  const startedAt = performance.now();
  const chunks: ArrayBuffer[] = [];
  let maxMainThreadSliceMs = 0;
  for (let offset = 0; offset < byteLength; offset += EROSION_READBACK_CHUNK_BYTES) {
    assertErosionNotAborted(signal);
    const chunkBytes = Math.min(EROSION_READBACK_CHUNK_BYTES, byteLength - offset);
    const readback = device.createBuffer({
      label: `${label}-${offset}`,
      size: chunkBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    try {
      const encoder = device.createCommandEncoder({ label: `${label}-copy-${offset}` });
      encoder.copyBufferToBuffer(source, offset, readback, 0, chunkBytes);
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      assertErosionNotAborted(signal);
      await readback.mapAsync(GPUMapMode.READ);
      assertErosionNotAborted(signal);
      const sliceStartedAt = performance.now();
      const chunk = readback.getMappedRange().slice(0);
      maxMainThreadSliceMs = Math.max(maxMainThreadSliceMs, performance.now() - sliceStartedAt);
      chunks.push(chunk);
      readback.unmap();
    } finally {
      readback.destroy();
    }
    await yieldErosionTask(signal);
  }
  return {
    chunks,
    byteLength,
    readbackMs: performance.now() - startedAt,
    maxMainThreadSliceMs,
  };
}

export function erosionGpuOutputByteLength(initial: ErosionGpuInitialState): number {
  return initial.sourceWidth * initial.sourceHeight * GPU_OUTPUT_WORDS_PER_CELL * Uint32Array.BYTES_PER_ELEMENT;
}

export async function readErosionGpuOutputChunks(
  device: GPUDevice,
  output: GPUBuffer,
  initial: ErosionGpuInitialState,
  signal?: AbortSignal,
): Promise<ErosionGpuChunkReadback> {
  return readBufferChunks(device, output, erosionGpuOutputByteLength(initial), "erosion-output-readback", signal);
}

export async function readErosionGpuCheckpoint(
  device: GPUDevice,
  buffers: Pick<ErosionGpuBuffers, "stateA">,
  initial: ErosionGpuInitialState,
  sourceTerrainHash: string,
  configHash: string,
  hydraulicIteration: number,
  thermalIteration: number,
  signal?: AbortSignal,
): Promise<{ readonly checkpoint: ErosionGpuCheckpoint; readonly readbackMs: number; readonly maxMainThreadSliceMs: number }> {
  const cellCount = initial.width * initial.height;
  const stateAByteLength = cellCount * GPU_STATE_A_WORDS_PER_CELL * Uint32Array.BYTES_PER_ELEMENT;
  const stateA = await readBufferChunks(
    device,
    buffers.stateA,
    stateAByteLength,
    "erosion-checkpoint-state-a",
    signal,
  );
  const checkpoint: ErosionGpuCheckpoint = Object.freeze({
    kind: "gpu",
    schemaVersion: EROSION_SCHEMA_VERSION,
    sourceTerrainHash,
    configHash,
    hydraulicIteration,
    thermalIteration,
    initial: Object.freeze({
      sourceWidth: initial.sourceWidth,
      sourceHeight: initial.sourceHeight,
      width: initial.width,
      height: initial.height,
      borderCells: initial.borderCells,
      cellSizeM: initial.cellSizeM,
      originX: initial.originX,
      originZ: initial.originZ,
    }),
    stateAByteLength,
    stateAChunks: stateA.chunks,
  });
  return {
    checkpoint,
    readbackMs: stateA.readbackMs,
    maxMainThreadSliceMs: stateA.maxMainThreadSliceMs,
  };
}
