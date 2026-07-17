// Per-frame frustum culling for resident CLOD terrain meshlets.
//
// buildMeshlets writes one drawIndexedIndirect command per meshlet at page build with
// instanceCount = 1, so every meshlet of every rendered page is drawn. This pass flips
// each command's instanceCount to 0/1 against the camera frustum using the meshlet
// bounds spheres that already live on the GPU, making the terrain draws camera-driven
// without any readback: the compute submit lands on the shared queue before three.js
// submits the render, so queue ordering is the only synchronisation needed.
//
// Resident terrain meshes never cast shadows (the CLOD shadow proxies do), so the
// camera frustum is the only view that consumes these indirect buffers.
import * as THREE from "three";
import { getCurrentRendererGpuDevice } from "../../rendering/webgpu_device_bridge.js";
import { eachGpuClodResidentPage } from "./gpu_clod_resident_registry.js";
import type { GpuClodMeshletBuffers } from "./gpu_clod_resident_types.js";

export const GPU_CLOD_MESHLET_CULL_WORKGROUP_SIZE = 64;

export const GPU_CLOD_MESHLET_CULL_WGSL = /* wgsl */ `
struct FrustumParams {
  planes : array<vec4<f32>, 6>,
};

@group(0) @binding(0) var<uniform> frustum : FrustumParams;
@group(0) @binding(1) var<storage, read> bounds : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> indirect : array<u32>;

@compute @workgroup_size(${GPU_CLOD_MESHLET_CULL_WORKGROUP_SIZE})
fn cullMeshlets(@builtin(global_invocation_id) gid : vec3<u32>) {
  let meshletId = gid.x;
  if (meshletId >= arrayLength(&bounds)) { return; }
  let sphere = bounds[meshletId];
  var visible = true;
  for (var planeIndex = 0u; planeIndex < 6u; planeIndex++) {
    let plane = frustum.planes[planeIndex];
    if (dot(plane.xyz, sphere.xyz) + plane.w < -sphere.w) { visible = false; }
  }
  indirect[meshletId * 5u + 1u] = select(0u, 1u, visible);
}
`;

export interface GpuClodMeshletCullStats {
  enabled: boolean;
  ready: boolean;
  pages: number;
  meshlets: number;
  dispatches: number;
}

interface CullState {
  device: GPUDevice;
  pipeline: GPUComputePipeline | null;
  pipelineFailed: boolean;
  frustumBuffer: GPUBuffer;
  bindGroups: WeakMap<GpuClodMeshletBuffers, GPUBindGroup>;
}

const FRUSTUM_FLOATS = 24;

let state: CullState | null = null;
let enabledOverride: boolean | null = null;
let lastStats: GpuClodMeshletCullStats = { enabled: false, ready: false, pages: 0, meshlets: 0, dispatches: 0 };

const planeScratch = new Float32Array(new ArrayBuffer(FRUSTUM_FLOATS * Float32Array.BYTES_PER_ELEMENT));
const frustumScratch = new THREE.Frustum();
const frustumMatrixScratch = new THREE.Matrix4();

function cullEnabled(): boolean {
  if (enabledOverride !== null) return enabledOverride;
  const search = (globalThis as typeof globalThis & { window?: { location?: { search?: string } } })
    .window?.location?.search ?? "";
  enabledOverride = new URLSearchParams(search).get("clodMeshletCull") !== "0";
  return enabledOverride;
}

/** Test hook: force enable/disable (pass null to re-read the query param). */
export function setGpuClodMeshletCullEnabled(enabled: boolean | null): void {
  enabledOverride = enabled;
}

export function gpuClodMeshletCullStats(): GpuClodMeshletCullStats {
  return lastStats;
}

export function resetGpuClodMeshletCull(): void {
  state?.frustumBuffer.destroy();
  state = null;
  lastStats = { enabled: false, ready: false, pages: 0, meshlets: 0, dispatches: 0 };
}

export function packFrustumPlanes<T extends Float32Array>(camera: THREE.Camera, out: T): T {
  camera.updateMatrixWorld();
  frustumMatrixScratch.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustumScratch.setFromProjectionMatrix(frustumMatrixScratch);
  for (let planeIndex = 0; planeIndex < 6; planeIndex++) {
    const plane = frustumScratch.planes[planeIndex]!;
    const offset = planeIndex * 4;
    out[offset] = plane.normal.x;
    out[offset + 1] = plane.normal.y;
    out[offset + 2] = plane.normal.z;
    out[offset + 3] = plane.constant;
  }
  return out;
}

/** TS mirror of the WGSL predicate, for parity tests against THREE.Frustum. */
export function meshletVisibleForPlanes(planes: Float32Array, sphere: readonly [number, number, number, number]): boolean {
  for (let planeIndex = 0; planeIndex < 6; planeIndex++) {
    const offset = planeIndex * 4;
    const distance = planes[offset]! * sphere[0] + planes[offset + 1]! * sphere[1] + planes[offset + 2]! * sphere[2] + planes[offset + 3]!;
    if (distance < -sphere[3]) return false;
  }
  return true;
}

function ensureState(device: GPUDevice): CullState {
  if (state && state.device === device) return state;
  state?.frustumBuffer.destroy();
  const next: CullState = {
    device,
    pipeline: null,
    pipelineFailed: false,
    frustumBuffer: device.createBuffer({
      label: "gpu clod meshlet cull frustum",
      size: FRUSTUM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
    bindGroups: new WeakMap(),
  };
  state = next;
  const module = device.createShaderModule({ label: "gpu clod meshlet cull", code: GPU_CLOD_MESHLET_CULL_WGSL });
  void device.createComputePipelineAsync({
    label: "gpu clod meshlet cull",
    layout: "auto",
    compute: { module, entryPoint: "cullMeshlets" },
  }).then((pipeline) => {
    if (state === next) next.pipeline = pipeline;
  }).catch((error) => {
    if (state === next) next.pipelineFailed = true;
    console.error("[clod-meshlet-cull] pipeline creation failed", error);
  });
  return next;
}

function bindGroupFor(current: CullState, meshlets: GpuClodMeshletBuffers): GPUBindGroup {
  const cached = current.bindGroups.get(meshlets);
  if (cached) return cached;
  const bindGroup = current.device.createBindGroup({
    label: "gpu clod meshlet cull bind group",
    layout: current.pipeline!.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: current.frustumBuffer } },
      { binding: 1, resource: { buffer: meshlets.bounds } },
      { binding: 2, resource: { buffer: meshlets.indirect } },
    ],
  });
  current.bindGroups.set(meshlets, bindGroup);
  return bindGroup;
}

/** Encode + submit the meshlet cull for every live resident page. Call once per frame
 *  (terrain frame phase) before three.js renders; no-op without a WebGPU device. */
export function updateGpuClodMeshletCull(camera: THREE.Camera | undefined): void {
  const enabled = cullEnabled();
  if (!enabled || !camera) {
    lastStats = { enabled, ready: false, pages: 0, meshlets: 0, dispatches: lastStats.dispatches };
    return;
  }
  const device = getCurrentRendererGpuDevice();
  if (!device) {
    lastStats = { enabled, ready: false, pages: 0, meshlets: 0, dispatches: lastStats.dispatches };
    return;
  }
  const current = ensureState(device);
  if (!current.pipeline || current.pipelineFailed) {
    lastStats = { enabled, ready: false, pages: 0, meshlets: 0, dispatches: lastStats.dispatches };
    return;
  }

  const pages: GpuClodMeshletBuffers[] = [];
  let meshletTotal = 0;
  eachGpuClodResidentPage((page) => {
    const meshlets = page.meshlets;
    if (!meshlets || meshlets.meshletCount <= 0) return;
    pages.push(meshlets);
    meshletTotal += meshlets.meshletCount;
  });
  if (pages.length === 0) {
    lastStats = { enabled, ready: true, pages: 0, meshlets: 0, dispatches: lastStats.dispatches };
    return;
  }

  device.queue.writeBuffer(current.frustumBuffer, 0, packFrustumPlanes(camera, planeScratch));
  const encoder = device.createCommandEncoder({ label: "gpu clod meshlet cull encoder" });
  const pass = encoder.beginComputePass({ label: "gpu clod meshlet cull pass" });
  pass.setPipeline(current.pipeline);
  for (const meshlets of pages) {
    pass.setBindGroup(0, bindGroupFor(current, meshlets));
    pass.dispatchWorkgroups(Math.ceil(meshlets.meshletCount / GPU_CLOD_MESHLET_CULL_WORKGROUP_SIZE));
  }
  pass.end();
  device.queue.submit([encoder.finish()]);
  lastStats = {
    enabled,
    ready: true,
    pages: pages.length,
    meshlets: meshletTotal,
    dispatches: lastStats.dispatches + pages.length,
  };
}

export function mirrorGpuClodMeshletCullCounters(counters: Record<string, number>): void {
  counters["clod_meshlet_cull_enabled"] = lastStats.enabled ? 1 : 0;
  counters["clod_meshlet_cull_ready"] = lastStats.ready ? 1 : 0;
  counters["clod_meshlet_cull_pages"] = lastStats.pages;
  counters["clod_meshlet_cull_meshlets"] = lastStats.meshlets;
  counters["clod_meshlet_cull_dispatches"] = lastStats.dispatches;
}
