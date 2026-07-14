import farSummaryBindings from "./shaders/far_summary_bindings.wgsl?raw";
import farSummaryBuild from "./shaders/far_summary_build.wgsl?raw";
import farSummaryRenderAtlasBindings from "./shaders/far_summary_render_atlas_bindings.wgsl?raw";
import farSummaryRenderAtlasBuild from "./shaders/far_summary_render_atlas_build.wgsl?raw";
import terrainFieldCommon from "../gpu/shaders/terrain_field_common.wgsl?raw";
import { composeShader } from "../gpu/wgsl_compose.js";
import { DIG_EDIT_BYTES, FIELD_PARAM_WORDS, packDigEdits, packFieldParams } from "../gpu/gpu_mesh_buffers.js";
import {
  FAR_SUMMARY_RENDER_ATLAS_DESCRIPTOR_BYTES,
  FAR_SUMMARY_RENDER_ATLAS_FORMAT,
  FAR_SUMMARY_RENDER_ATLAS_MAX_TILES_PER_DISPATCH,
  FAR_SUMMARY_RENDER_ATLAS_RECORD_BYTES,
  FAR_SUMMARY_RENDER_ATLAS_WORKGROUP_SIZE,
} from "./gpu-render-atlas-constants.js";
import type {
  CreateFarSummaryGpuRenderAtlasOptions,
  FarSummaryGpuRenderAtlasPlan,
  FarSummaryGpuRenderAtlasTile,
  FarSummaryRenderAtlasPipelineState,
  FarSummaryRenderAtlasTextureSet,
} from "./gpu-render-atlas-types.js";

export async function createFarSummaryRenderAtlasPipeline(
  device: GPUDevice,
): Promise<FarSummaryRenderAtlasPipelineState> {
  const shader = composeShader("far summary render atlas shader", [
    farSummaryBindings,
    farSummaryRenderAtlasBindings,
    terrainFieldCommon,
    farSummaryBuild,
    farSummaryRenderAtlasBuild,
  ]);
  const module = device.createShaderModule({ label: "far summary render atlas shader", code: shader });
  const storage = (binding: number, type: GPUBufferBindingType = "storage"): GPUBindGroupLayoutEntry => ({
    binding,
    visibility: GPUShaderStage.COMPUTE,
    buffer: { type },
  });
  const storageTexture = (binding: number): GPUBindGroupLayoutEntry => ({
    binding,
    visibility: GPUShaderStage.COMPUTE,
    storageTexture: { access: "write-only", format: FAR_SUMMARY_RENDER_ATLAS_FORMAT, viewDimension: "2d" },
  });
  const layout = device.createBindGroupLayout({
    label: "far summary render atlas layout",
    entries: [
      storage(0, "read-only-storage"),
      storage(1),
      storage(2, "read-only-storage"),
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      storage(4),
      storageTexture(5),
      storageTexture(6),
      storageTexture(7),
      storageTexture(8),
    ],
  });
  const pipeline = await device.createComputePipelineAsync({
    label: "far summary render atlas pipeline",
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: "build_far_summary_render_atlas" },
  });
  return { layout, pipeline };
}

export function submitFarSummaryRenderAtlasPlan(
  options: CreateFarSummaryGpuRenderAtlasOptions,
  pipelineState: FarSummaryRenderAtlasPipelineState,
  back: FarSummaryRenderAtlasTextureSet,
  front: FarSummaryRenderAtlasTextureSet,
  width: number,
  height: number,
  plan: FarSummaryGpuRenderAtlasPlan,
): void {
  const encoder = options.device.createCommandEncoder({ label: "far summary render atlas encoder" });
  clearBackTextures(encoder, back);
  const resources: GPUBuffer[] = [];

  for (let start = 0; start < plan.tiles.length; start += FAR_SUMMARY_RENDER_ATLAS_MAX_TILES_PER_DISPATCH) {
    const tiles = plan.tiles.slice(start, start + FAR_SUMMARY_RENDER_ATLAS_MAX_TILES_PER_DISPATCH);
    const batch = createBatchResources(options.device, tiles, options.terrainFieldConfig);
    resources.push(...batch.buffers);
    const bindGroup = options.device.createBindGroup({
      label: "far summary render atlas bind group",
      layout: pipelineState.layout,
      entries: [
        { binding: 0, resource: { buffer: batch.descriptors } },
        { binding: 1, resource: { buffer: batch.records } },
        { binding: 2, resource: { buffer: batch.digEdits } },
        { binding: 3, resource: { buffer: batch.fieldParams } },
        { binding: 4, resource: { buffer: batch.cellRecords } },
        { binding: 5, resource: back.height.createView() },
        { binding: 6, resource: back.material.createView() },
        { binding: 7, resource: back.normal.createView() },
        { binding: 8, resource: back.coverage.createView() },
      ],
    });
    const pass = encoder.beginComputePass({ label: "far summary render atlas compute" });
    pass.setPipeline(pipelineState.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.max(1, Math.ceil(tiles.length / FAR_SUMMARY_RENDER_ATLAS_WORKGROUP_SIZE)));
    pass.end();
  }

  copyTextureSet(encoder, back, front, width, height);
  options.device.queue.submit([encoder.finish()]);
  for (const buffer of resources) buffer.destroy();
}

interface BatchResources {
  descriptors: GPUBuffer;
  records: GPUBuffer;
  digEdits: GPUBuffer;
  fieldParams: GPUBuffer;
  cellRecords: GPUBuffer;
  buffers: GPUBuffer[];
}

function createBatchResources(
  device: GPUDevice,
  tiles: readonly FarSummaryGpuRenderAtlasTile[],
  terrainFieldConfig?: CreateFarSummaryGpuRenderAtlasOptions["terrainFieldConfig"],
): BatchResources {
  const descriptorData = packDescriptors(tiles);
  const fieldParamsData = packFieldParams(0, terrainFieldConfig);
  const descriptors = createBuffer(
    device,
    "far summary render atlas descriptors",
    descriptorData.byteLength,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );
  const records = createBuffer(
    device,
    "far summary render atlas records",
    Math.max(4, tiles.length * FAR_SUMMARY_RENDER_ATLAS_RECORD_BYTES),
    GPUBufferUsage.STORAGE,
  );
  const digEdits = createBuffer(
    device,
    "far summary render atlas dig edits",
    DIG_EDIT_BYTES,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );
  const fieldParams = createBuffer(
    device,
    "far summary render atlas field params",
    FIELD_PARAM_WORDS * Uint32Array.BYTES_PER_ELEMENT,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  );
  const cellRecords = createBuffer(
    device,
    "far summary render atlas unused cells",
    4,
    GPUBufferUsage.STORAGE,
  );

  device.queue.writeBuffer(descriptors, 0, descriptorData);
  device.queue.writeBuffer(digEdits, 0, packDigEdits([]));
  device.queue.writeBuffer(
    fieldParams,
    0,
    fieldParamsData.buffer as ArrayBuffer,
    fieldParamsData.byteOffset,
    fieldParamsData.byteLength,
  );
  return {
    descriptors,
    records,
    digEdits,
    fieldParams,
    cellRecords,
    buffers: [descriptors, records, digEdits, fieldParams, cellRecords],
  };
}

export function packFarSummaryRenderAtlasDescriptors(
  tiles: readonly FarSummaryGpuRenderAtlasTile[],
): ArrayBuffer {
  const buffer = new ArrayBuffer(Math.max(1, tiles.length) * FAR_SUMMARY_RENDER_ATLAS_DESCRIPTOR_BYTES);
  const view = new DataView(buffer);
  for (let index = 0; index < tiles.length; index++) {
    const tile = tiles[index]!;
    const base = index * FAR_SUMMARY_RENDER_ATLAS_DESCRIPTOR_BYTES;
    view.setInt32(base, tile.tileX, true);
    view.setInt32(base + 4, tile.tileZ, true);
    view.setUint32(base + 8, tile.ring, true);
    view.setUint32(base + 12, tile.tileCells, true);
    view.setFloat32(base + 16, tile.originX, true);
    view.setFloat32(base + 20, tile.originZ, true);
    view.setFloat32(base + 24, tile.sizeX, true);
    view.setFloat32(base + 28, tile.sizeZ, true);
    view.setUint32(base + 32, tile.revision, true);
    view.setUint32(base + 36, 0, true);
    view.setUint32(base + 40, tile.tileCells, true);
    view.setFloat32(base + 44, tile.cellSizeM, true);
    view.setUint32(base + 48, 0, true);
    view.setUint32(base + 52, tile.atlasX, true);
    view.setUint32(base + 56, tile.atlasY, true);
    view.setUint32(base + 60, 0, true);
  }
  return buffer;
}

function packDescriptors(tiles: readonly FarSummaryGpuRenderAtlasTile[]): ArrayBuffer {
  return packFarSummaryRenderAtlasDescriptors(tiles);
}

function createBuffer(device: GPUDevice, label: string, size: number, usage: GPUBufferUsageFlags): GPUBuffer {
  return device.createBuffer({ label, size: Math.max(4, Math.ceil(size / 4) * 4), usage });
}

function clearBackTextures(
  encoder: GPUCommandEncoder,
  textures: FarSummaryRenderAtlasTextureSet,
): void {
  const pass = encoder.beginRenderPass({
    label: "far summary render atlas clear",
    colorAttachments: [textures.height, textures.material, textures.normal, textures.coverage].map((texture) => ({
      view: texture.createView(),
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
      loadOp: "clear" as const,
      storeOp: "store" as const,
    })),
  });
  pass.end();
}

function copyTextureSet(
  encoder: GPUCommandEncoder,
  source: FarSummaryRenderAtlasTextureSet,
  destination: FarSummaryRenderAtlasTextureSet,
  width: number,
  height: number,
): void {
  const extent = { width, height, depthOrArrayLayers: 1 };
  encoder.copyTextureToTexture({ texture: source.height }, { texture: destination.height }, extent);
  encoder.copyTextureToTexture({ texture: source.material }, { texture: destination.material }, extent);
  encoder.copyTextureToTexture({ texture: source.normal }, { texture: destination.normal }, extent);
  encoder.copyTextureToTexture({ texture: source.coverage }, { texture: destination.coverage }, extent);
}
