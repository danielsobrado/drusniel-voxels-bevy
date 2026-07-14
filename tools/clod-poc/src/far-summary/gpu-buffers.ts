import type { TerrainFieldConfig } from "../terrain/terrain.js";
import { DIG_EDIT_BYTES, FIELD_PARAM_WORDS, packDigEdits, packFieldParams } from "../gpu/gpu_mesh_buffers.js";
import type { FarSummaryGpuBatch, FarSummaryGpuDirtyTile } from "./gpu-planner.js";
import type { FarTerrainSampler } from "./summary-tile-builder.js";
import { FAR_SUMMARY_LAYOUT_VERSION } from "./types.js";
import {
  FAR_SUMMARY_GPU_DESCRIPTOR_BYTES,
  FAR_SUMMARY_GPU_DESCRIPTOR_FLAG_CANONICAL_SAMPLES,
  FAR_SUMMARY_GPU_DESCRIPTOR_FLAG_CELL_RECORDS,
  FAR_SUMMARY_GPU_RECORD_BYTES,
  farSummaryUnifiedLayoutEnabledForScene,
  type FarSummaryGpuConfig,
} from "./gpu-config.js";

const I32 = 4;
const U32 = 4;
const F32 = 4;
const INFINITE_ISLANDS_SCENE = "infinite-islands";

export interface FarSummaryGpuBatchBufferSet {
  descriptorBuffer: GPUBuffer;
  outputBuffer: GPUBuffer;
  cellOutputBuffer: GPUBuffer;
  digEditsBuffer: GPUBuffer;
  fieldParamsBuffer: GPUBuffer;
  canonicalSampleBuffer: GPUBuffer;
  readbackBuffer: GPUBuffer | null;
  cellReadbackBuffer: GPUBuffer | null;
  descriptorBytes: number;
  outputBytes: number;
  cellOutputBytes: number;
  readbackBytes: number;
  cellReadbackBytes: number;
  destroy: () => void;
}

export function packFarSummaryGpuDescriptors(
  tiles: readonly FarSummaryGpuDirtyTile[],
  config: Pick<FarSummaryGpuConfig, "commitToCache"> = { commitToCache: false },
  canonicalSamples = false,
): ArrayBuffer {
  const buffer = new ArrayBuffer(Math.max(1, tiles.length) * FAR_SUMMARY_GPU_DESCRIPTOR_BYTES);
  const view = new DataView(buffer);
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i]!;
    const base = i * FAR_SUMMARY_GPU_DESCRIPTOR_BYTES;
    const flags = (config.commitToCache ? FAR_SUMMARY_GPU_DESCRIPTOR_FLAG_CELL_RECORDS : 0)
      | (canonicalSamples ? FAR_SUMMARY_GPU_DESCRIPTOR_FLAG_CANONICAL_SAMPLES : 0);
    view.setInt32(base, tile.tileX, true);
    view.setInt32(base + I32, tile.tileZ, true);
    view.setUint32(base + I32 * 2, tile.ring, true);
    view.setUint32(base + I32 * 3, tile.sampleGrid, true);
    view.setFloat32(base + I32 * 4, tile.originX, true);
    view.setFloat32(base + I32 * 4 + F32, tile.originZ, true);
    view.setFloat32(base + I32 * 4 + F32 * 2, tile.sizeX, true);
    view.setFloat32(base + I32 * 4 + F32 * 3, tile.sizeZ, true);
    view.setUint32(base + I32 * 4 + F32 * 4, tile.revision, true);
    view.setUint32(base + I32 * 4 + F32 * 4 + U32, flags, true);
    view.setUint32(base + I32 * 4 + F32 * 4 + U32 * 2, tile.tileCells, true);
    view.setFloat32(base + I32 * 4 + F32 * 4 + U32 * 3, tile.cellSizeM, true);
    view.setUint32(base + I32 * 4 + F32 * 4 + U32 * 4, tile.cellRecordOffset ?? 0, true);
    view.setUint32(base + I32 * 4 + F32 * 4 + U32 * 5, FAR_SUMMARY_LAYOUT_VERSION, true);
    view.setUint32(base + I32 * 4 + F32 * 4 + U32 * 6, canonicalSampleOffset(tiles, i), true);
    view.setUint32(base + I32 * 4 + F32 * 4 + U32 * 7, tile.tileCells + 2, true);
  }
  return buffer;
}

function canonicalSampleOffset(tiles: readonly FarSummaryGpuDirtyTile[], target: number): number {
  let offset = 0;
  for (let i = 0; i < target; i++) {
    const stride = tiles[i]!.tileCells + 2;
    offset += stride * stride;
  }
  return offset;
}

export function packFarSummaryCanonicalSamples(
  tiles: readonly FarSummaryGpuDirtyTile[],
  sampler: FarTerrainSampler,
): Float32Array {
  let sampleCount = 0;
  for (const tile of tiles) {
    const stride = tile.tileCells + 2;
    sampleCount += stride * stride;
  }
  const packed = new Float32Array(Math.max(1, sampleCount) * 2);
  let offset = 0;
  for (const tile of tiles) {
    for (let z = -1; z <= tile.tileCells; z++) {
      for (let x = -1; x <= tile.tileCells; x++) {
        const worldX = tile.originX + (x + 0.5) * tile.cellSizeM;
        const worldZ = tile.originZ + (z + 0.5) * tile.cellSizeM;
        packed[offset++] = sampler.sampleHeight(worldX, worldZ);
        packed[offset++] = sampler.sampleMaterial?.(worldX, worldZ) ?? 0;
      }
    }
  }
  return packed;
}

export function farSummaryGpuUsesCanonicalSamples(
  terrainSampler: FarTerrainSampler | undefined,
  params = currentQueryParams(),
): boolean {
  if (!terrainSampler) return false;
  if (params.get("farSummaryGpuCanonicalSamples") === "1") return true;
  if (params.get("farSummaryGpuCanonicalSamples") === "0") return false;
  return params.get("scene") !== INFINITE_ISLANDS_SCENE
    || !farSummaryUnifiedLayoutEnabledForScene(params);
}

export function farSummaryGpuReadbackTileCount(
  tileCount: number,
  config: FarSummaryGpuConfig,
): number {
  return config.debugReadback ? Math.min(tileCount, config.debugReadbackTiles) : 0;
}

export function createFarSummaryGpuBatchBuffers(
  device: GPUDevice,
  batch: FarSummaryGpuBatch,
  config: FarSummaryGpuConfig,
  terrainFieldConfig?: TerrainFieldConfig,
  terrainSampler?: FarTerrainSampler,
): FarSummaryGpuBatchBufferSet {
  const descriptorBytes = Math.max(4, batch.tiles.length * FAR_SUMMARY_GPU_DESCRIPTOR_BYTES);
  const outputBytes = Math.max(4, batch.tiles.length * FAR_SUMMARY_GPU_RECORD_BYTES);
  const cellOutputBytes = Math.max(4, batch.cellOutputBytes);
  const readbackTiles = farSummaryGpuReadbackTileCount(batch.tiles.length, config);
  const readbackBytes = readbackTiles * FAR_SUMMARY_GPU_RECORD_BYTES;
  const cellReadbackBytes = config.commitToCache ? batch.cellReadbackBytes : 0;
  const digEditsBytes = DIG_EDIT_BYTES;
  const fieldParamsBytes = FIELD_PARAM_WORDS * U32;
  const useCanonicalSamples = farSummaryGpuUsesCanonicalSamples(terrainSampler);
  const canonicalSampleData = useCanonicalSamples
    ? packFarSummaryCanonicalSamples(batch.tiles, terrainSampler!)
    : new Float32Array(2);
  const canonicalSampleBytes = Math.max(8, canonicalSampleData.byteLength);

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
  const cellOutputBuffer = device.createBuffer({
    label: "far summary gpu cell output records",
    size: cellOutputBytes,
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
  const canonicalSampleBuffer = device.createBuffer({
    label: "far summary canonical terrain samples",
    size: canonicalSampleBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const readbackBuffer = readbackBytes > 0 ? device.createBuffer({
    label: "far summary gpu debug readback",
    size: Math.max(4, readbackBytes),
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  }) : null;
  const cellReadbackBuffer = cellReadbackBytes > 0 ? device.createBuffer({
    label: "far summary gpu cell readback",
    size: Math.max(4, cellReadbackBytes),
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  }) : null;

  const descriptorData = packFarSummaryGpuDescriptors(batch.tiles, config, useCanonicalSamples);
  const fieldParams = packFieldParams(0, terrainFieldConfig);
  device.queue.writeBuffer(descriptorBuffer, 0, descriptorData, 0, descriptorBytes);
  device.queue.writeBuffer(digEditsBuffer, 0, packDigEdits([]));
  device.queue.writeBuffer(
    canonicalSampleBuffer,
    0,
    canonicalSampleData.buffer as ArrayBuffer,
    canonicalSampleData.byteOffset,
    canonicalSampleData.byteLength,
  );
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
    cellOutputBuffer,
    digEditsBuffer,
    fieldParamsBuffer,
    canonicalSampleBuffer,
    readbackBuffer,
    cellReadbackBuffer,
    descriptorBytes,
    outputBytes,
    cellOutputBytes,
    readbackBytes,
    cellReadbackBytes,
    destroy: () => {
      descriptorBuffer.destroy();
      outputBuffer.destroy();
      cellOutputBuffer.destroy();
      digEditsBuffer.destroy();
      fieldParamsBuffer.destroy();
      canonicalSampleBuffer.destroy();
      readbackBuffer?.destroy();
      cellReadbackBuffer?.destroy();
    },
  };
}

function currentQueryParams(): URLSearchParams {
  const maybeWindow = (globalThis as typeof globalThis & { window?: { location?: { search?: string } } }).window;
  return new URLSearchParams(maybeWindow?.location?.search ?? "");
}
