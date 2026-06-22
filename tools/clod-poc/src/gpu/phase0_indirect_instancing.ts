import * as THREE from "three";
import {
  MeshBasicNodeMaterial,
  StorageBufferAttribute,
  StorageInstancedBufferAttribute,
} from "three/webgpu";
import type { WebGPURenderer } from "three/webgpu";
import {
  instanceIndex,
  positionGeometry,
  storage,
} from "three/tsl";

const WORKGROUP_SIZE = 64;
const INDIRECT_ARGS = 5;
const PARAM_BYTES = 4 * Uint32Array.BYTES_PER_ELEMENT;

interface Phase0GpuBackend {
  createStorageAttribute(attribute: THREE.BufferAttribute): void;
  createIndirectStorageAttribute(attribute: THREE.BufferAttribute): void;
  get(attribute: THREE.BufferAttribute): { buffer?: GPUBuffer };
}

type IndirectInstancedBufferGeometry = THREE.InstancedBufferGeometry & {
  setIndirect?(attribute: THREE.BufferAttribute, offset: number): void;
};

export interface Phase0IndirectInstances {
  mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>;
  count: number;
  indirectDraws: number;
}

export function phase0IndirectDrawUnsupportedReason(): string | null {
  const prototype = THREE.InstancedBufferGeometry.prototype as IndirectInstancedBufferGeometry;
  return typeof prototype.setIndirect === "function"
    ? null
    : "Phase-0 indirect proof requires InstancedBufferGeometry.setIndirect support";
}

export function phase0IndirectWorkgroups(count: number): number {
  return Math.max(1, Math.ceil(Math.max(0, Math.floor(count)) / WORKGROUP_SIZE));
}

export async function createPhase0IndirectInstances(
  renderer: WebGPURenderer,
  count: number,
  seed: number,
): Promise<Phase0IndirectInstances> {
  const unsupported = phase0IndirectDrawUnsupportedReason();
  if (unsupported) throw new Error(unsupported);

  const capacity = Math.max(1, Math.floor(count));
  const instanceA = new StorageInstancedBufferAttribute(capacity, 4);
  instanceA.name = "phase0-indirect-instance-a";
  const instanceB = new StorageInstancedBufferAttribute(capacity, 4);
  instanceB.name = "phase0-indirect-instance-b";
  const indirect = new StorageBufferAttribute(new Uint32Array(INDIRECT_ARGS), INDIRECT_ARGS);
  indirect.name = "phase0-indirect-args";

  const backend = renderer.backend as unknown as Phase0GpuBackend;
  backend.createStorageAttribute(instanceA);
  backend.createStorageAttribute(instanceB);
  backend.createIndirectStorageAttribute(indirect);

  const base = new THREE.BoxGeometry(1, 1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", base.getAttribute("position"));
  geometry.setAttribute("normal", base.getAttribute("normal"));
  geometry.setAttribute("uv", base.getAttribute("uv"));
  geometry.setIndex(base.getIndex());
  geometry.instanceCount = capacity;
  const indexCount = base.getIndex()?.count ?? base.getAttribute("position").count;
  base.dispose();

  (geometry as IndirectInstancedBufferGeometry).setIndirect?.(indirect, 0);

  const device = (renderer.backend as unknown as { device?: GPUDevice }).device;
  if (!device) throw new Error("Phase-0 indirect proof requires a WebGPU device");

  await fillPhase0IndirectBuffers(device, {
    instanceA: gpuBufferForAttribute(backend, instanceA),
    instanceB: gpuBufferForAttribute(backend, instanceB),
    indirect: gpuBufferForAttribute(backend, indirect),
    count: capacity,
    indexCount,
    seed,
  });

  const material = createPhase0IndirectMaterial(instanceA, instanceB, capacity);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "phase0-indirect-instances";
  mesh.frustumCulled = false;
  return { mesh, count: capacity, indirectDraws: 1 };
}

function createPhase0IndirectMaterial(
  instanceA: StorageInstancedBufferAttribute,
  instanceB: StorageInstancedBufferAttribute,
  capacity: number,
): MeshBasicNodeMaterial {
  const aStore = storage(instanceA, "vec4", capacity).toReadOnly();
  const bStore = storage(instanceB, "vec4", capacity).toReadOnly();
  const a = aStore.element(instanceIndex);
  const b = bStore.element(instanceIndex);
  const material = new MeshBasicNodeMaterial();
  material.positionNode = positionGeometry.mul(a.w).add(a.xyz);
  material.colorNode = b.xyz;
  return material;
}

interface Phase0IndirectFill {
  instanceA: GPUBuffer;
  instanceB: GPUBuffer;
  indirect: GPUBuffer;
  count: number;
  indexCount: number;
  seed: number;
}

async function fillPhase0IndirectBuffers(device: GPUDevice, fill: Phase0IndirectFill): Promise<void> {
  const paramScratch = new ArrayBuffer(PARAM_BYTES);
  const params = new Uint32Array(paramScratch);
  params[0] = fill.count >>> 0;
  params[1] = fill.indexCount >>> 0;
  params[2] = fill.seed >>> 0;
  params[3] = 0;

  const paramBuffer = device.createBuffer({
    label: "phase0 indirect params",
    size: PARAM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(paramBuffer, 0, paramScratch);

  const module = device.createShaderModule({
    label: "phase0 indirect fill shader",
    code: /* wgsl */ `
struct Params {
  count: u32,
  index_count: u32,
  seed: u32,
  _pad: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> instance_a: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> instance_b: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> indirect_args: array<u32>;

fn hash_u32(v: u32) -> f32 {
  var x = v ^ (v >> 16u);
  x = x * 0x7feb352du;
  x = x ^ (x >> 15u);
  x = x * 0x846ca68bu;
  x = x ^ (x >> 16u);
  return f32(x & 0x00ffffffu) / 16777215.0;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn fill(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i == 0u) {
    indirect_args[0] = params.index_count;
    indirect_args[1] = params.count;
    indirect_args[2] = 0u;
    indirect_args[3] = 0u;
    indirect_args[4] = 0u;
  }
  if (i >= params.count) {
    return;
  }

  let fi = f32(i);
  let columns = 32.0;
  let col = fi - floor(fi / columns) * columns;
  let row = floor(fi / columns);
  let jitter_x = hash_u32(i + params.seed * 17u) - 0.5;
  let jitter_z = hash_u32(i + params.seed * 31u + 97u) - 0.5;
  let scale = 0.22 + hash_u32(i + params.seed * 43u + 211u) * 0.42;

  instance_a[i] = vec4<f32>(
    -30.0 + col * 0.72 + jitter_x * 0.16,
    2.0 + hash_u32(i + params.seed * 59u + 313u) * 3.5,
    8.0 + row * 0.72 + jitter_z * 0.16,
    scale
  );
  instance_b[i] = vec4<f32>(
    0.86,
    0.20 + hash_u32(i + params.seed * 71u + 401u) * 0.35,
    0.12 + hash_u32(i + params.seed * 83u + 557u) * 0.22,
    1.0
  );
}
`,
  });
  const layout = device.createBindGroupLayout({
    label: "phase0 indirect fill layout",
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });
  const pipeline = await device.createComputePipelineAsync({
    label: "phase0 indirect fill pipeline",
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: "fill" },
  });
  const bindGroup = device.createBindGroup({
    label: "phase0 indirect fill bind group",
    layout,
    entries: [
      { binding: 0, resource: { buffer: paramBuffer } },
      { binding: 1, resource: { buffer: fill.instanceA } },
      { binding: 2, resource: { buffer: fill.instanceB } },
      { binding: 3, resource: { buffer: fill.indirect } },
    ],
  });

  const encoder = device.createCommandEncoder({ label: "phase0 indirect fill encoder" });
  const pass = encoder.beginComputePass({ label: "phase0 indirect fill pass" });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(phase0IndirectWorkgroups(fill.count));
  pass.end();
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  paramBuffer.destroy();
}

function gpuBufferForAttribute(backend: Phase0GpuBackend, attribute: THREE.BufferAttribute): GPUBuffer {
  const buffer = backend.get(attribute).buffer;
  if (!buffer) throw new Error(`Missing GPU buffer for ${attribute.name || "phase0 indirect attribute"}`);
  return buffer;
}
