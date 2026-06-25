import * as THREE from "three";
import { StorageBufferAttribute, StorageInstancedBufferAttribute } from "three/webgpu";
import { DIG_EDIT_BYTES, packDigEdits, packFieldParams } from "./gpu_mesh_buffers.js";
import type { ResolvedDigEdit } from "./terrain_field_core.js";
import { composeUnderstoryRingShader } from "./wgsl_modules.js";
import { UNDERSTORY_CLASSES, type UnderstoryClass, type UnderstorySettings } from "../understory/understory_config.js";
import { createUnderstoryGeometryMap, disposeUnderstoryGeometryMap, type UnderstoryGeometryMap } from "../understory/understory_geometry.js";
import { createUnderstoryRingNodeMaterialHandle, type UnderstoryRingInstanceBuffers } from "../understory/understory_node_material.js";
import type { UnderstoryMaterialHandle } from "../understory/understory_material.js";
import {
  understoryRingClassBaseOffset,
  understoryRingGroupIndex,
  UNDERSTORY_RING_CLASS_STRIDE_F32,
  UNDERSTORY_RING_GROUP_COUNT,
  UNDERSTORY_RING_PARAM_BYTES,
  understoryRingGroupCapacity,
  packUnderstoryRingClassParams,
  packUnderstoryRingParams,
  resolveUnderstoryRingReadbackCounts,
  understoryRingCullWorkgroups,
  understoryRingRequestsDebugReadback,
  understoryRingSlotCount,
  type UnderstoryRingCounts,
} from "../understory/understory_ring_math.js";
import type { EnvironmentLighting } from "../environment/environment.js";

const CLASS_PARAMS_BYTES = UNDERSTORY_RING_GROUP_COUNT * UNDERSTORY_RING_CLASS_STRIDE_F32 * Float32Array.BYTES_PER_ELEMENT;
const COUNTER_BYTES = UNDERSTORY_RING_GROUP_COUNT * Uint32Array.BYTES_PER_ELEMENT;
const READBACK_SLOTS = 2;

export const UNDERSTORY_GPU_RING_STORAGE_BINDINGS = 5;

export interface UnderstoryGpuRingOutputBuffers {
  cell: GPUBuffer;
  indirectArgs: GPUBuffer;
}

export interface UnderstoryHydrologyData {
  res: number;
  worldCells: number;
  data: Float32Array;
}

export interface UnderstoryGpuRingStats {
  status: "initializing" | "idle" | "running" | "ready" | "failed" | "disabled";
  reason?: string;
  candidateCount: number;
  acceptedCandidates: number;
  counts: UnderstoryRingCounts;
  groupCounts: number[];
  overflowed: boolean;
  submitMs: number | null;
  readbackMs: number | null;
  skippedDispatches: number;
}

export interface UnderstoryGpuRingDispatchParams {
  centerX: number;
  centerZ: number;
  worldCells: number;
  maxInstancesPerGroup: number;
  indexCounts: [number, number, number, number, number, number];
  frustumPlanes: ArrayLike<number>;
  hydroEnabled?: boolean;
}

interface ReadbackSlot {
  buffer: GPUBuffer;
  busy: boolean;
  destroyAfterMap: boolean;
  cpu: Uint32Array;
}

type PipelineName = "clear_counters" | "understory_cull" | "build_indirect_args";

export function understoryGpuRingComputeUnsupportedReason(device: GPUDevice): string | null {
  const maxStorageBuffers = device.limits.maxStorageBuffersPerShaderStage;
  if (maxStorageBuffers >= UNDERSTORY_GPU_RING_STORAGE_BINDINGS) return null;
  return `understory ring compute requires ${UNDERSTORY_GPU_RING_STORAGE_BINDINGS} storage buffers per shader stage; device limit is ${maxStorageBuffers}`;
}

export class UnderstoryGpuRingCompute {
  private readonly paramBuffer: GPUBuffer;
  private readonly classParamsBuffer: GPUBuffer;
  private readonly counterBuffer: GPUBuffer;
  private readonly counterReadbacks: ReadbackSlot[];
  private readonly fieldParams: GPUBuffer;
  private digEdits: GPUBuffer;
  private readonly bindGroup: GPUBindGroup;
  private readonly hydroTexture: GPUTexture;
  private readonly paramScratch = new ArrayBuffer(UNDERSTORY_RING_PARAM_BYTES);
  private readonly classParamsScratch = new Float32Array(UNDERSTORY_RING_GROUP_COUNT * UNDERSTORY_RING_CLASS_STRIDE_F32);
  private readonly pipelines: Record<PipelineName, GPUComputePipeline>;
  private counts: UnderstoryRingCounts = { shrub: 0, fern: 0, sapling: 0, flower: 0, dead_log: 0, stump: 0 };
  private groupCounts = new Array<number>(UNDERSTORY_RING_GROUP_COUNT).fill(0);
  private overflowed = false;
  private runningReadbacks = 0;
  private failedReason: string | null = null;
  private submitMs: number | null = null;
  private readbackMs: number | null = null;
  private skippedDispatches = 0;
  private generation = 0;
  private frame = 0;

  private constructor(
    private readonly device: GPUDevice,
    layout: GPUBindGroupLayout,
    pipelines: Record<PipelineName, GPUComputePipeline>,
    edits: readonly ResolvedDigEdit[],
    outputBuffers: UnderstoryGpuRingOutputBuffers,
    private readonly settings: UnderstorySettings,
    hydroData: UnderstoryHydrologyData | null,
  ) {
    this.pipelines = pipelines;
    this.paramBuffer = device.createBuffer({
      label: "understory ring params",
      size: UNDERSTORY_RING_PARAM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.classParamsBuffer = device.createBuffer({
      label: "understory ring class params",
      size: CLASS_PARAMS_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.counterBuffer = device.createBuffer({
      label: "understory ring counters",
      size: COUNTER_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this.fieldParams = device.createBuffer({
      label: "understory ring field params",
      size: 4 * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.digEdits = device.createBuffer({
      label: "understory ring dig edits",
      size: Math.max(1, edits.length) * DIG_EDIT_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.digEdits, 0, packDigEdits(edits));
    const packedFieldParams = packFieldParams(edits.length);
    device.queue.writeBuffer(
      this.fieldParams,
      0,
      packedFieldParams.buffer as ArrayBuffer,
      packedFieldParams.byteOffset,
      packedFieldParams.byteLength,
    );
    this.counterReadbacks = Array.from({ length: READBACK_SLOTS }, (_, index) => ({
      buffer: device.createBuffer({
        label: `understory ring counter readback ${index}`,
        size: COUNTER_BYTES,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      }),
      busy: false,
      destroyAfterMap: false,
      cpu: new Uint32Array(UNDERSTORY_RING_GROUP_COUNT),
    }));
    // Create hydrology texture from raw data, or a 1x1 fallback
    if (hydroData && hydroData.data.length > 0) {
      this.hydroTexture = device.createTexture({
        label: "understory ring hydro texture",
        size: { width: hydroData.res, height: hydroData.res },
        format: "rgba32float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      device.queue.writeTexture(
        { texture: this.hydroTexture },
        hydroData.data.buffer as ArrayBuffer,
        { bytesPerRow: hydroData.res * 16 },
        { width: hydroData.res, height: hydroData.res },
      );
    } else {
      this.hydroTexture = device.createTexture({
        label: "understory ring fallback hydro texture",
        size: { width: 1, height: 1 },
        format: "rgba32float",
        usage: GPUTextureUsage.TEXTURE_BINDING,
      });
    }
    const hydroSampler = device.createSampler({
      label: "understory ring hydro sampler",
      magFilter: "nearest",
      minFilter: "nearest",
    });
    this.bindGroup = device.createBindGroup({
      label: "understory ring bind group",
      layout,
      entries: [
        { binding: 0, resource: { buffer: this.paramBuffer } },
        { binding: 1, resource: { buffer: this.counterBuffer } },
        { binding: 2, resource: { buffer: outputBuffers.indirectArgs } },
        { binding: 3, resource: { buffer: outputBuffers.cell } },
        { binding: 4, resource: { buffer: this.classParamsBuffer } },
        { binding: 5, resource: this.hydroTexture.createView() },
        { binding: 6, resource: hydroSampler },
        { binding: 7, resource: { buffer: this.digEdits } },
        { binding: 8, resource: { buffer: this.fieldParams } },
      ],
    });
  }

  static async create(
    device: GPUDevice,
    edits: readonly ResolvedDigEdit[],
    outputBuffers: UnderstoryGpuRingOutputBuffers,
    settings: UnderstorySettings,
    hydroData: UnderstoryHydrologyData | null = null,
  ): Promise<UnderstoryGpuRingCompute> {
    const module = device.createShaderModule({
      label: "understory ring compute shader",
      code: composeUnderstoryRingShader(settings.gpu.workgroupSize),
    });
    const storage = (binding: number, type: GPUBufferBindingType = "storage"): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type },
    });
    const layout = device.createBindGroupLayout({
      label: "understory ring compute layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        storage(1),
        storage(2),
        storage(3),
        storage(4, "read-only-storage"),
        { binding: 5, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, sampler: {} },
        storage(7, "read-only-storage"),
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      ],
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const makePipeline = (entryPoint: PipelineName) =>
      device.createComputePipelineAsync({
        label: `understory ring ${entryPoint}`,
        layout: pipelineLayout,
        compute: { module, entryPoint },
      });
    const [clearCounters, cull, buildIndirectArgs] = await Promise.all([
      makePipeline("clear_counters"),
      makePipeline("understory_cull"),
      makePipeline("build_indirect_args"),
    ]);
    return new UnderstoryGpuRingCompute(device, layout, {
      clear_counters: clearCounters,
      understory_cull: cull,
      build_indirect_args: buildIndirectArgs,
    }, edits, outputBuffers, { ...settings }, hydroData);
  }

  dispatch(params: UnderstoryGpuRingDispatchParams): boolean {
    if (this.failedReason) return false;

    const frame = this.frame++;
    const requestReadback = understoryRingRequestsDebugReadback(this.settings, frame);
    const readbackSlot = requestReadback
      ? this.counterReadbacks.find((candidate) => !candidate.busy) ?? null
      : null;
    if (requestReadback && !readbackSlot) this.skippedDispatches++;

    packUnderstoryRingParams(this.settings, params, this.paramScratch);
    this.device.queue.writeBuffer(this.paramBuffer, 0, this.paramScratch);

    packUnderstoryRingClassParams(this.settings, this.classParamsScratch);
    this.device.queue.writeBuffer(this.classParamsBuffer, 0, this.classParamsScratch);

    const encoder = this.device.createCommandEncoder({ label: "understory ring compute encoder" });
    this.dispatchPipeline(encoder, this.pipelines.clear_counters, 1);
    this.dispatchPipeline(
      encoder,
      this.pipelines.understory_cull,
      understoryRingCullWorkgroups(this.settings),
    );
    this.dispatchPipeline(encoder, this.pipelines.build_indirect_args, 1);
    if (readbackSlot) {
      encoder.copyBufferToBuffer(this.counterBuffer, 0, readbackSlot.buffer, 0, COUNTER_BYTES);
    }

    const submittedGeneration = this.generation;
    const submitStart = performance.now();
    if (readbackSlot) {
      readbackSlot.busy = true;
      readbackSlot.destroyAfterMap = false;
      this.runningReadbacks++;
    }
    this.device.queue.submit([encoder.finish()]);
    this.submitMs = performance.now() - submitStart;

    if (readbackSlot) {
      const slot = readbackSlot;
      const readbackStart = performance.now();
      void slot.buffer.mapAsync(GPUMapMode.READ).then(() => {
        if (submittedGeneration !== this.generation) {
          slot.busy = false;
          slot.destroyAfterMap = false;
          this.runningReadbacks = Math.max(0, this.runningReadbacks - 1);
          slot.buffer.unmap();
          slot.buffer.destroy();
          return;
        }
        slot.cpu.set(new Uint32Array(slot.buffer.getMappedRange(0, COUNTER_BYTES)));
        slot.buffer.unmap();
        slot.busy = false;
        this.runningReadbacks = Math.max(0, this.runningReadbacks - 1);
        this.readbackMs = performance.now() - readbackStart;
        const resolved = resolveUnderstoryRingReadbackCounts(slot.cpu, params.maxInstancesPerGroup);
        this.groupCounts = resolved.groupCounts;
        this.counts = resolved.counts;
        this.overflowed = resolved.overflowed;
        if (slot.destroyAfterMap) {
          slot.destroyAfterMap = false;
          slot.buffer.destroy();
        }
      }).catch((error) => {
        if (submittedGeneration !== this.generation) {
          slot.busy = false;
          slot.destroyAfterMap = false;
          this.runningReadbacks = Math.max(0, this.runningReadbacks - 1);
          slot.buffer.destroy();
          return;
        }
        slot.busy = false;
        this.runningReadbacks = Math.max(0, this.runningReadbacks - 1);
        if (slot.destroyAfterMap) {
          slot.destroyAfterMap = false;
          slot.buffer.destroy();
          return;
        }
        this.failedReason = error instanceof Error ? error.message : String(error);
      });
    }
    return true;
  }

  stats(enabled: boolean): UnderstoryGpuRingStats {
    const acceptedCandidates = Object.values(this.counts).reduce((a, b) => a + b, 0);
    return {
      status: !enabled
        ? "disabled"
        : this.failedReason
          ? "failed"
          : this.runningReadbacks > 0 ? "running" : "ready",
      reason: this.failedReason ?? undefined,
      candidateCount: understoryRingSlotCount(this.settings),
      acceptedCandidates,
      counts: { ...this.counts },
      groupCounts: [...this.groupCounts],
      overflowed: this.overflowed,
      submitMs: this.submitMs,
      readbackMs: this.readbackMs,
      skippedDispatches: this.skippedDispatches,
    };
  }

  destroy(): void {
    this.generation++;
    this.runningReadbacks = 0;
    this.paramBuffer.destroy();
    this.classParamsBuffer.destroy();
    this.counterBuffer.destroy();
    this.digEdits.destroy();
    this.fieldParams.destroy();
    this.hydroTexture.destroy();
    for (const slot of this.counterReadbacks) {
      if (slot.busy) slot.destroyAfterMap = true;
      else slot.buffer.destroy();
    }
  }

  private dispatchPipeline(encoder: GPUCommandEncoder, pipeline: GPUComputePipeline, workgroups: number): void {
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.max(1, workgroups));
    pass.end();
  }
}

// ---------------------------------------------------------------------------
// Ring draw resources (mirrors TreeSystem's createGpuRingDrawResources pattern)
// ---------------------------------------------------------------------------

type UnderstoryGpuRingMesh = THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>;

type IndirectInstancedBufferGeometry = THREE.InstancedBufferGeometry & {
  setIndirect?(attribute: THREE.BufferAttribute, offset: number): void;
};

export interface UnderstoryGpuRingDrawResources {
  meshes: UnderstoryGpuRingMesh[];
  cell: StorageInstancedBufferAttribute;
  indirect: StorageBufferAttribute;
  outputBuffers: UnderstoryGpuRingOutputBuffers;
  materialHandles: Record<UnderstoryClass, UnderstoryMaterialHandle>;
  geometries: UnderstoryGeometryMap;
}

export interface UnderstoryWebGpuBackendAccess {
  createStorageAttribute(attribute: THREE.BufferAttribute): void;
  createIndirectStorageAttribute(attribute: THREE.BufferAttribute): void;
  get(attribute: THREE.BufferAttribute): { buffer?: GPUBuffer };
}

export function createGpuRingDrawResources(
  settings: UnderstorySettings,
  worldCells: number,
  gpuBackend: UnderstoryWebGpuBackendAccess,
  lighting?: EnvironmentLighting,
): UnderstoryGpuRingDrawResources {
  const maxPerGroup = understoryRingGroupCapacity(settings);
  const count = Math.max(1, maxPerGroup);
  const sharedInstanceCount = count * UNDERSTORY_RING_GROUP_COUNT;

  const indirect = new StorageBufferAttribute(new Uint32Array(UNDERSTORY_RING_GROUP_COUNT * 5), 5);
  indirect.name = "understory-ring-indirect";
  gpuBackend.createIndirectStorageAttribute(indirect);

  const cell = new StorageInstancedBufferAttribute(sharedInstanceCount, 4);
  cell.name = "understory-ring-cell";
  gpuBackend.createStorageAttribute(cell);

  const ringBuffers: UnderstoryRingInstanceBuffers = { cell, capacity: sharedInstanceCount };

  const geometries = createUnderstoryGeometryMap(settings);
  const meshes: UnderstoryGpuRingMesh[] = [];
  const materialHandles = {} as Record<UnderstoryClass, UnderstoryMaterialHandle>;

  for (const cls of UNDERSTORY_CLASSES) {
    const clsSettings = settings.classes[cls];
    const group = understoryRingGroupIndex(cls);
    const classBaseOffset = understoryRingClassBaseOffset(group, count);
    const handle = createUnderstoryRingNodeMaterialHandle(settings, ringBuffers, lighting, clsSettings.minScale, clsSettings.maxScale, classBaseOffset);
    materialHandles[cls] = handle;
    meshes.push(createGpuRingTierDraw(
      settings,
      cls,
      count,
      indirect,
      group * 5 * Uint32Array.BYTES_PER_ELEMENT,
      handle,
      geometries,
      worldCells,
    ));
  }

  return {
    meshes,
    cell,
    indirect,
    outputBuffers: {
      cell: gpuBufferForAttribute(cell, gpuBackend),
      indirectArgs: gpuBufferForAttribute(indirect, gpuBackend),
    },
    materialHandles,
    geometries,
  };
}

function gpuRingClassCastsShadow(settings: UnderstorySettings, cls: UnderstoryClass): boolean {
  if (!settings.render.shadows) return false;
  return UNDERSTORY_CLASSES.indexOf(cls) <= UNDERSTORY_CLASSES.indexOf(settings.render.maxShadowClass);
}

function createGpuRingTierDraw(
  settings: UnderstorySettings,
  cls: UnderstoryClass,
  count: number,
  indirect: StorageBufferAttribute,
  indirectOffset: number,
  materialHandle: UnderstoryMaterialHandle,
  geometries: UnderstoryGeometryMap,
  worldCells: number,
): UnderstoryGpuRingMesh {
  const source = geometries[cls];
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex(source.getIndex());
  for (const name of Object.keys(source.attributes)) {
    geometry.setAttribute(name, source.getAttribute(name));
  }
  geometry.instanceCount = count;
  setGpuRingIndirect(geometry, indirect, indirectOffset);
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(-1, -1, -1),
    new THREE.Vector3(worldCells + 1, 256, worldCells + 1),
  );
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
  const mesh = new THREE.Mesh(
    geometry,
    settings.render.debugColorByClass ? materialHandle.debugMaterials[cls] : materialHandle.regularMaterial,
  );
  mesh.name = `understory-ring-gpu-${cls}`;
  mesh.frustumCulled = false;
  mesh.castShadow = gpuRingClassCastsShadow(settings, cls);
  mesh.receiveShadow = false;
  return mesh;
}

function setGpuRingIndirect(
  geometry: THREE.InstancedBufferGeometry,
  indirect: StorageBufferAttribute,
  indirectOffset: number,
): void {
  const indirectGeometry = geometry as IndirectInstancedBufferGeometry;
  if (!indirectGeometry.setIndirect) {
    throw new Error("understory GPU ring requires InstancedBufferGeometry.setIndirect support");
  }
  indirectGeometry.setIndirect(indirect, indirectOffset);
}

function gpuBufferForAttribute(attribute: THREE.BufferAttribute, gpuBackend: UnderstoryWebGpuBackendAccess): GPUBuffer {
  const buffer = gpuBackend.get(attribute).buffer;
  if (!buffer) throw new Error(`Missing GPU buffer for ${attribute.name || "understory ring attribute"}`);
  return buffer;
}

export function clearGpuRingDraw(draw: UnderstoryGpuRingDrawResources | null): void {
  if (!draw) return;
  for (const mesh of draw.meshes) {
    mesh.geometry.dispose();
  }
  for (const handle of Object.values(draw.materialHandles)) {
    handle.dispose();
  }
  disposeUnderstoryGeometryMap(draw.geometries);
}
