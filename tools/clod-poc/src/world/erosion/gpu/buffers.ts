import { assertErosionNotAborted, yieldErosionTask } from "../abort.js";
import { EROSION_ASYNC_ROWS_PER_YIELD } from "../constants.js";
import type { ErosionGpuCheckpoint, ErosionGpuInitialState, ErosionSourceField } from "../types.js";

export const GPU_STATE_A_WORDS_PER_CELL = 7;
export const GPU_STATE_B_WORDS_PER_CELL = 6;
export const GPU_OUTPUT_WORDS_PER_CELL = 4;
export const GPU_CHECKPOINT_WORDS_PER_CELL = 8;
export const GPU_PARAMS_STRIDE_BYTES = 256;
export const GPU_PARAMS_BYTES = 80;

export interface ErosionGpuBuffers {
  readonly stateA: GPUBuffer;
  readonly stateB: GPUBuffer;
  readonly sedimentScratch: GPUBuffer;
  readonly params: GPUBuffer;
  readonly talus: GPUBuffer;
  readonly outputPlaceholder: GPUBuffer;
  readonly checkpointInput: GPUBuffer | null;
  output: GPUBuffer | null;
}

function initialLayout(source: ErosionSourceField, borderCells: number, samplingMs: number): ErosionGpuInitialState {
  const width = source.width + borderCells * 2;
  const height = source.height + borderCells * 2;
  return {
    sourceWidth: source.width,
    sourceHeight: source.height,
    width,
    height,
    borderCells,
    cellSizeM: source.cellSizeM,
    originX: source.originX,
    originZ: source.originZ,
    stateAData: new ArrayBuffer(width * height * GPU_STATE_A_WORDS_PER_CELL * Uint32Array.BYTES_PER_ELEMENT),
    samplingMs,
  };
}

function packRow(
  source: ErosionSourceField,
  initial: ErosionGpuInitialState,
  u32: Uint32Array,
  i32: Int32Array,
  z: number,
): void {
  const sourceZ = Math.min(source.height - 1, Math.max(0, z - initial.borderCells));
  for (let x = 0; x < initial.width; x++) {
    const sourceX = Math.min(source.width - 1, Math.max(0, x - initial.borderCells));
    const sourceIndex = sourceZ * source.width + sourceX;
    const offset = (z * initial.width + x) * GPU_STATE_A_WORDS_PER_CELL;
    i32[offset] = source.heightFixed[sourceIndex]!;
    u32[offset + 1] = source.hardness[sourceIndex]!;
  }
}

export function packErosionGpuInitialState(
  source: ErosionSourceField,
  borderCells: number,
  samplingMs = 0,
): ErosionGpuInitialState {
  const initial = initialLayout(source, borderCells, samplingMs);
  const u32 = new Uint32Array(initial.stateAData);
  const i32 = new Int32Array(initial.stateAData);
  for (let z = 0; z < initial.height; z++) packRow(source, initial, u32, i32, z);
  return initial;
}

export async function packErosionGpuInitialStateAsync(
  source: ErosionSourceField,
  borderCells: number,
  samplingMs: number,
  signal?: AbortSignal,
): Promise<ErosionGpuInitialState> {
  const initial = initialLayout(source, borderCells, samplingMs);
  const u32 = new Uint32Array(initial.stateAData);
  const i32 = new Int32Array(initial.stateAData);
  for (let z = 0; z < initial.height; z++) {
    assertErosionNotAborted(signal);
    packRow(source, initial, u32, i32, z);
    if ((z + 1) % EROSION_ASYNC_ROWS_PER_YIELD === 0) await yieldErosionTask(signal);
  }
  return initial;
}

function createMappedBuffer(device: GPUDevice, label: string, data: ArrayBuffer, usage: GPUBufferUsageFlags): GPUBuffer {
  const buffer = device.createBuffer({ label, size: data.byteLength, usage, mappedAtCreation: true });
  new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data));
  buffer.unmap();
  return buffer;
}

function createBufferFromChunks(
  device: GPUDevice,
  label: string,
  byteLength: number,
  usage: GPUBufferUsageFlags,
  chunks: readonly ArrayBuffer[],
): GPUBuffer {
  const buffer = device.createBuffer({ label, size: byteLength, usage: usage | GPUBufferUsage.COPY_DST });
  let offset = 0;
  for (const chunk of chunks) {
    if (offset + chunk.byteLength > byteLength) {
      buffer.destroy();
      throw new Error(`${label} checkpoint chunks exceed the declared byte length`);
    }
    device.queue.writeBuffer(buffer, offset, chunk);
    offset += chunk.byteLength;
  }
  if (offset !== byteLength) {
    buffer.destroy();
    throw new Error(`${label} checkpoint chunks are incomplete`);
  }
  return buffer;
}

export function createErosionGpuBuffers(
  device: GPUDevice,
  initial: ErosionGpuInitialState,
  paramsData: ArrayBuffer,
  talusData: Uint32Array,
  checkpoint?: ErosionGpuCheckpoint,
): ErosionGpuBuffers {
  const cellCount = initial.width * initial.height;
  const stateBBytes = cellCount * GPU_STATE_B_WORDS_PER_CELL * Uint32Array.BYTES_PER_ELEMENT;
  return {
    stateA: createMappedBuffer(
      device,
      "erosion-state-a",
      initial.stateAData,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    ),
    stateB: device.createBuffer({
      label: "erosion-state-b",
      size: stateBBytes,
      usage: GPUBufferUsage.STORAGE,
    }),
    sedimentScratch: device.createBuffer({
      label: "erosion-sediment-scratch",
      size: cellCount * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE,
    }),
    params: createMappedBuffer(device, "erosion-params", paramsData, GPUBufferUsage.UNIFORM),
    talus: createMappedBuffer(
      device,
      "erosion-talus-table",
      talusData.buffer.slice(talusData.byteOffset, talusData.byteOffset + talusData.byteLength) as ArrayBuffer,
      GPUBufferUsage.STORAGE,
    ),
    outputPlaceholder: device.createBuffer({
      label: "erosion-output-placeholder",
      size: GPU_OUTPUT_WORDS_PER_CELL * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE,
    }),
    checkpointInput: checkpoint
      ? createBufferFromChunks(
          device,
          "erosion-checkpoint-input",
          checkpoint.packedByteLength,
          GPUBufferUsage.STORAGE,
          checkpoint.packedChunks,
        )
      : null,
    output: null,
  };
}

export function createErosionGpuOutputBuffer(device: GPUDevice, buffers: ErosionGpuBuffers, sourceCellCount: number): GPUBuffer {
  if (buffers.output) return buffers.output;
  buffers.output = device.createBuffer({
    label: "erosion-output",
    size: sourceCellCount * GPU_OUTPUT_WORDS_PER_CELL * Uint32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  return buffers.output;
}

export function createErosionGpuCheckpointBuffer(device: GPUDevice, cellCount: number): GPUBuffer {
  return device.createBuffer({
    label: "erosion-checkpoint-output",
    size: cellCount * GPU_CHECKPOINT_WORDS_PER_CELL * Uint32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
}

export function destroyErosionGpuSimulationBuffers(buffers: ErosionGpuBuffers): void {
  buffers.stateA.destroy();
  buffers.stateB.destroy();
  buffers.sedimentScratch.destroy();
  buffers.params.destroy();
  buffers.talus.destroy();
  buffers.outputPlaceholder.destroy();
  buffers.checkpointInput?.destroy();
}

export function destroyErosionGpuBuffers(buffers: ErosionGpuBuffers): void {
  destroyErosionGpuSimulationBuffers(buffers);
  buffers.output?.destroy();
}
