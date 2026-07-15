import type { ErosionGpuInitialState, ErosionSourceField } from "../types.js";

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
  readonly output: GPUBuffer;
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

export function createErosionGpuBuffers(
  device: GPUDevice,
  initial: ErosionGpuInitialState,
  paramsData: ArrayBuffer,
  talusData: Uint32Array,
): ErosionGpuBuffers {
  const cellCount = initial.width * initial.height;
  const outputCount = initial.sourceWidth * initial.sourceHeight;
  return {
    stateA: createMappedBuffer(
      device,
      "erosion-state-a",
      initial.stateAData,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    ),
    stateB: device.createBuffer({
      label: "erosion-state-b",
      size: cellCount * GPU_STATE_B_WORDS_PER_CELL * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE,
    }),
    sedimentScratch: device.createBuffer({
      label: "erosion-sediment-scratch",
      size: cellCount * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE,
    }),
    params: createMappedBuffer(
      device,
      "erosion-params",
      paramsData,
      GPUBufferUsage.UNIFORM,
    ),
    talus: createMappedBuffer(
      device,
      "erosion-talus-table",
      talusData.buffer.slice(talusData.byteOffset, talusData.byteOffset + talusData.byteLength) as ArrayBuffer,
      GPUBufferUsage.STORAGE,
    ),
    output: device.createBuffer({
      label: "erosion-output",
      size: outputCount * GPU_OUTPUT_WORDS_PER_CELL * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    }),
  };
}

export function destroyErosionGpuSimulationBuffers(buffers: ErosionGpuBuffers): void {
  buffers.stateA.destroy();
  buffers.stateB.destroy();
  buffers.sedimentScratch.destroy();
  buffers.params.destroy();
  buffers.talus.destroy();
}

export function destroyErosionGpuBuffers(buffers: ErosionGpuBuffers): void {
  destroyErosionGpuSimulationBuffers(buffers);
  buffers.output.destroy();
}
