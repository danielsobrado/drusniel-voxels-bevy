import type { ErosionGpuCheckpoint, ErosionGpuInitialState, ErosionSourceField } from "../types.js";

export const GPU_STATE_A_WORDS_PER_CELL = 7;
export const GPU_STATE_B_WORDS_PER_CELL = 6;
export const GPU_OUTPUT_WORDS_PER_CELL = 4;
export const GPU_PARAMS_STRIDE_BYTES = 256;
export const GPU_PARAMS_BYTES = 80;

export interface ErosionGpuBuffers {
  readonly stateA: GPUBuffer;
  readonly stateB: GPUBuffer;
  readonly sedimentScratch: GPUBuffer;
  readonly params: GPUBuffer;
  readonly talus: GPUBuffer;
  readonly outputPlaceholder: GPUBuffer;
  output: GPUBuffer | null;
}

export function packErosionGpuInitialState(source: ErosionSourceField, borderCells: number): ErosionGpuInitialState {
  const width = source.width + borderCells * 2;
  const height = source.height + borderCells * 2;
  const data = new ArrayBuffer(width * height * GPU_STATE_A_WORDS_PER_CELL * Uint32Array.BYTES_PER_ELEMENT);
  const u32 = new Uint32Array(data);
  const i32 = new Int32Array(data);
  for (let z = 0; z < height; z++) {
    const sourceZ = Math.min(source.height - 1, Math.max(0, z - borderCells));
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(source.width - 1, Math.max(0, x - borderCells));
      const sourceIndex = sourceZ * source.width + sourceX;
      const offset = (z * width + x) * GPU_STATE_A_WORDS_PER_CELL;
      i32[offset] = source.heightFixed[sourceIndex]!;
      u32[offset + 1] = source.hardness[sourceIndex]!;
    }
  }
  return {
    sourceWidth: source.width,
    sourceHeight: source.height,
    width,
    height,
    borderCells,
    cellSizeM: source.cellSizeM,
    originX: source.originX,
    originZ: source.originZ,
    stateAData: data,
  };
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
  const stateABytes = cellCount * GPU_STATE_A_WORDS_PER_CELL * Uint32Array.BYTES_PER_ELEMENT;
  const stateBBytes = cellCount * GPU_STATE_B_WORDS_PER_CELL * Uint32Array.BYTES_PER_ELEMENT;
  const stateAUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC;
  const stateBUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC;
  const stateA = checkpoint
    ? createBufferFromChunks(device, "erosion-state-a", stateABytes, stateAUsage, checkpoint.stateAChunks)
    : createMappedBuffer(device, "erosion-state-a", initial.stateAData, stateAUsage);
  const stateB = checkpoint
    ? createBufferFromChunks(device, "erosion-state-b", stateBBytes, stateBUsage, checkpoint.stateBChunks)
    : device.createBuffer({ label: "erosion-state-b", size: stateBBytes, usage: stateBUsage });
  return {
    stateA,
    stateB,
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

export function destroyErosionGpuSimulationBuffers(buffers: ErosionGpuBuffers): void {
  buffers.stateA.destroy();
  buffers.stateB.destroy();
  buffers.sedimentScratch.destroy();
  buffers.params.destroy();
  buffers.talus.destroy();
  buffers.outputPlaceholder.destroy();
}

export function destroyErosionGpuBuffers(buffers: ErosionGpuBuffers): void {
  destroyErosionGpuSimulationBuffers(buffers);
  buffers.output?.destroy();
}
