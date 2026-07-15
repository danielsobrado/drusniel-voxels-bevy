import { EROSION_SCHEMA_VERSION } from "../constants.js";
import type { ErosionGpuCheckpoint, ErosionGpuInitialState } from "../types.js";
import type { ErosionGpuBuffers } from "./buffers.js";
import { GPU_OUTPUT_WORDS_PER_CELL, GPU_STATE_A_WORDS_PER_CELL, GPU_STATE_B_WORDS_PER_CELL } from "./buffers.js";

const READBACK_CHUNK_BYTES = 4 * 1024 * 1024;

export interface ErosionGpuChunkReadback {
  readonly chunks: readonly ArrayBuffer[];
  readonly byteLength: number;
  readonly readbackMs: number;
  readonly maxMainThreadSliceMs: number;
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function readBufferChunks(
  device: GPUDevice,
  source: GPUBuffer,
  byteLength: number,
  label: string,
): Promise<ErosionGpuChunkReadback> {
  const startedAt = performance.now();
  const chunks: ArrayBuffer[] = [];
  let maxMainThreadSliceMs = 0;
  for (let offset = 0; offset < byteLength; offset += READBACK_CHUNK_BYTES) {
    const chunkBytes = Math.min(READBACK_CHUNK_BYTES, byteLength - offset);
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
      await readback.mapAsync(GPUMapMode.READ);
      const sliceStartedAt = performance.now();
      const chunk = readback.getMappedRange().slice(0);
      maxMainThreadSliceMs = Math.max(maxMainThreadSliceMs, performance.now() - sliceStartedAt);
      chunks.push(chunk);
      readback.unmap();
    } finally {
      readback.destroy();
    }
    await nextTask();
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
): Promise<ErosionGpuChunkReadback> {
  return readBufferChunks(device, output, erosionGpuOutputByteLength(initial), "erosion-output-readback");
}

export async function readErosionGpuCheckpoint(
  device: GPUDevice,
  buffers: Pick<ErosionGpuBuffers, "stateA" | "stateB">,
  initial: ErosionGpuInitialState,
  sourceTerrainHash: string,
  configHash: string,
  hydraulicIteration: number,
  thermalIteration: number,
): Promise<{ readonly checkpoint: ErosionGpuCheckpoint; readonly readbackMs: number; readonly maxMainThreadSliceMs: number }> {
  const cellCount = initial.width * initial.height;
  const stateAByteLength = cellCount * GPU_STATE_A_WORDS_PER_CELL * Uint32Array.BYTES_PER_ELEMENT;
  const stateBByteLength = cellCount * GPU_STATE_B_WORDS_PER_CELL * Uint32Array.BYTES_PER_ELEMENT;
  const stateA = await readBufferChunks(device, buffers.stateA, stateAByteLength, "erosion-checkpoint-state-a");
  const stateB = await readBufferChunks(device, buffers.stateB, stateBByteLength, "erosion-checkpoint-state-b");
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
    stateBByteLength,
    stateAChunks: stateA.chunks,
    stateBChunks: stateB.chunks,
  });
  return {
    checkpoint,
    readbackMs: stateA.readbackMs + stateB.readbackMs,
    maxMainThreadSliceMs: Math.max(stateA.maxMainThreadSliceMs, stateB.maxMainThreadSliceMs),
  };
}
