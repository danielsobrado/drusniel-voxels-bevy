import type { TerrainFieldConfig } from "../terrain/terrain.js";
import { DIG_EDIT_BYTES, FIELD_PARAM_WORDS, packDigEdits, packFieldParams } from "../gpu/gpu_mesh_buffers.js";
import type { FarSummaryGpuBatch, FarSummaryGpuDirtyTile } from "./gpu-planner.js";
import {
  FAR_SUMMARY_GPU_DESCRIPTOR_BYTES,
  FAR_SUMMARY_GPU_RECORD_BYTES,
  type FarSummaryGpuConfig,
} from "./gpu-config.js";

const I32 = 4;
const U32 = 4;
const F32 = 4;

export interface FarSummaryGpuBatchBufferSet {
  descriptorBuffer: GPUBuffer;
  outputBuffer: GPUBuffer;
  digEditsBuffer: GPUBuffer;
  fieldParamsBuffer: GPUBuffer;
  readbackBuffer: GPUBuffer | null;
  descriptorBytes: number;
  outputBytes: number;
  readbackBytes: number;
  destroy: () => void;
}

export function packFarSummaryGpuDescriptors(tiles: readonly FarSummaryGpuDirtyTile[]): ArrayBuffer {
  const buffer = new ArrayBuffer(Math.max(1, tiles.length) * FAR_SUMMARY_GPU_DESCRIPTOR_BYTES);
  const view = new DataView(buffer);
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i]!;
    const base = i * FAR_SUMMARY_GPU_DESCRIPTOR_BYTES;
    view.setInt32(base, tile.tileX, true);
    view.setInt32(base + I32, tile.tileZ, true);
    view.setUint32(base + I32 * 2, tile.ring, true);
    view.setUint32(base + I32 * 3, tile.sampleGrid, true);
    view.setFloat32(base + I32 * 4, tile.originX, true);
    view.setFloat32(base + I32 * 4 + F32, tile.originZ, true);
    view.setFloat32(base + I32 * 4 + F32 * 2, tile.sizeX, true);
    view.setFloat32(base + I32 * 4 + F32 * 3, tile.sizeZ, true);
    view.setUint32(base + I32 * 4 + F32 * 4, tile.revision, true);
    view.setUint32(base + I32 * 4 + F32 * 4 + U32, 0, true);
    view.setUint32(base + I32 * 4 + F32 * 4 + U32 * 2, tile.tileCells, true);
    view.setFloat32(base + I32 * 4 + F32 * 4 + U32 * 3, tile.cellSizeM, true);
  }
  return buffer;
}

export function createFarSummaryGpuBatchBuffers(
  device: GPUDevice,
  batch: FarSummaryGpuBatch,
  config: FarSummaryGpuConfig,
  terrainFieldConfig?: TerrainFieldConfig,
): FarSummaryGpuBatchBufferSet {
  const descriptorBytes = Math.max(4, batch.tiles.length * FAR_SUMMARY_GPU_DESCRIPTOR_BYTES);
  const outputBytes = Math.max(4, batch.tiles.length * FAR_SUMMARY_GPU_RECORD_BYTES);
  const readbackTiles = config.debugReadback ? Math.min(batch.tiles.length, config.debugReadbackTiles) : 0;
  const readbackBytes = readbackTiles * FAR_SUMMARY_GPU_RECORD_BYTES;
  const digEditsBytes = DIG_EDIT_BYTES;
  const fieldParamsBytes = FIELD_PARAM_WORDS * U32;

  const descriptorBuffer = device.createBuffer({
    label: "far summary gpu descriptors",
    size: descriptorBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const outputBuffer = device.createBuffer({
    label: "far summary gpu output records",
    size: outputBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const digEditsBuffer = device.createBuffer({
    label: "far summary gpu dig edits",
    size: digEditsBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const fieldParamsBuffer = device.createBuffer({
    label: "far summary gpu field params",
    size: fieldParamsBytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const readbackBuffer = readbackBytes > 0 ? device.createBuffer({
    label: "far summary gpu debug readback",
    size: Math.max(4, readbackBytes),
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  }) : null;

  const descriptorData = packFarSummaryGpuDescriptors(batch.tiles);
  const fieldParams = packFieldParams(0, terrainFieldConfig);
  device.queue.writeBuffer(descriptorBuffer, 0, descriptorData, 0, descriptorBytes);
  device.queue.writeBuffer(digEditsBuffer, 0, packDigEdits([]));
  device.queue.writeBuffer(
    fieldParamsBuffer,
    0,
    fieldParams.buffer as ArrayBuffer,
    fieldParams.byteOffset,
    fieldParams.byteLength,
  );

  return {
    descriptorBuffer,
    outputBuffer,
    digEditsBuffer,
    fieldParamsBuffer,
    readbackBuffer,
    descriptorBytes,
    outputBytes,
    readbackBytes,
    destroy: () => {
      descriptorBuffer.destroy();
      outputBuffer.destroy();
      digEditsBuffer.destroy();
      fieldParamsBuffer.destroy();
      readbackBuffer?.destroy();
    },
  };
}
