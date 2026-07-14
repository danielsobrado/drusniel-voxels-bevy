import * as THREE from "three";
import {
  IndirectStorageBufferAttribute,
  type WebGPURenderer,
} from "three/webgpu";
import {
  GPU_CLOD_VERTEX_FLOATS,
  GPU_CLOD_VERTEX_LAYOUT,
  type GpuClodResidentPageLease,
} from "../terrain/streaming/gpu_clod_resident_types.js";

const EXTERNAL_GEOMETRY_KEY = "gpuClodExternalGeometry";
const INDEXED_INDIRECT_COMMAND_WORDS = 5;
const INDEXED_INDIRECT_COMMAND_BYTES = INDEXED_INDIRECT_COMMAND_WORDS * Uint32Array.BYTES_PER_ELEMENT;
const NON_OWNING_DISPOSE_BUFFER = { destroy: () => undefined } as unknown as GPUBuffer;

interface WebGpuBackendData {
  buffer?: GPUBuffer;
}

interface WebGpuBackendBridge {
  get(object: object): WebGpuBackendData;
}

interface ExternalGeometryState {
  lease: GpuClodResidentPageLease;
  backend: WebGpuBackendBridge;
  backendKeys: object[];
  originalDispose: () => void;
  released: boolean;
}

export function createExternalGpuClodGeometry(
  renderer: WebGPURenderer,
  lease: GpuClodResidentPageLease,
): THREE.BufferGeometry {
  const page = lease.page;
  const backend = renderer.backend as unknown as WebGpuBackendBridge;
  const backendKeys: object[] = [];
  const geometry = new THREE.BufferGeometry();
  const originalDispose = geometry.dispose.bind(geometry);
  const interleaved = new THREE.InterleavedBuffer(
    new Float32Array(GPU_CLOD_VERTEX_FLOATS),
    GPU_CLOD_VERTEX_FLOATS,
  );
  Object.defineProperty(interleaved, "count", {
    configurable: true,
    value: page.vertexCount,
    writable: true,
  });

  geometry.setAttribute("position", attribute(interleaved, GPU_CLOD_VERTEX_LAYOUT.position));
  geometry.setAttribute("rootMorphDeltaY", attribute(interleaved, GPU_CLOD_VERTEX_LAYOUT.rootMorphDeltaY));
  geometry.setAttribute("normal", attribute(interleaved, GPU_CLOD_VERTEX_LAYOUT.normal));
  geometry.setAttribute("biomeId", attribute(interleaved, GPU_CLOD_VERTEX_LAYOUT.biomeId));
  geometry.setAttribute("paintSlots", attribute(interleaved, GPU_CLOD_VERTEX_LAYOUT.paintSlots));
  geometry.setAttribute("paintWeights", attribute(interleaved, GPU_CLOD_VERTEX_LAYOUT.paintWeights));

  const index = new THREE.BufferAttribute(new Uint32Array(1), 1);
  Object.defineProperty(index, "count", {
    configurable: true,
    value: page.indexCount,
    writable: true,
  });
  geometry.setIndex(index);
  geometry.setDrawRange(0, page.indexCount);

  let indirectEnabled = false;
  if (page.meshlets && page.meshlets.meshletCount > 0) {
    const indirectWordCount = page.meshlets.meshletCount * INDEXED_INDIRECT_COMMAND_WORDS;
    const indirect = new IndirectStorageBufferAttribute(indirectWordCount, 1);
    geometry.indirect = indirect;
    geometry.indirectOffset = Array.from(
      { length: page.meshlets.meshletCount },
      (_, meshletIndex) => meshletIndex * INDEXED_INDIRECT_COMMAND_BYTES,
    );
    backend.get(indirect).buffer = page.meshlets.indirect;
    backendKeys.push(indirect);
    indirectEnabled = true;
  }

  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(...page.bounds.center),
    page.bounds.radius,
  );
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(
      page.bounds.center[0] - page.bounds.radius,
      page.bounds.minY,
      page.bounds.center[2] - page.bounds.radius,
    ),
    new THREE.Vector3(
      page.bounds.center[0] + page.bounds.radius,
      page.bounds.maxY,
      page.bounds.center[2] + page.bounds.radius,
    ),
  );

  backend.get(interleaved).buffer = page.vertexBuffer;
  backend.get(index).buffer = page.indexBuffer;
  backendKeys.push(interleaved, index);
  geometry.userData[EXTERNAL_GEOMETRY_KEY] = {
    lease,
    backend,
    backendKeys,
    originalDispose,
    released: false,
  } satisfies ExternalGeometryState;
  geometry.dispose = () => releaseExternalGpuClodGeometry(geometry);
  recordResidentView(indirectEnabled);
  return geometry;
}

export function isExternalGpuClodGeometry(geometry: THREE.BufferGeometry): boolean {
  return geometry.userData[EXTERNAL_GEOMETRY_KEY] !== undefined;
}

export function releaseExternalGpuClodGeometry(geometry: THREE.BufferGeometry): void {
  const state = geometry.userData[EXTERNAL_GEOMETRY_KEY] as ExternalGeometryState | undefined;
  if (!state || state.released) return;
  state.released = true;
  for (const key of state.backendKeys) state.backend.get(key).buffer = NON_OWNING_DISPOSE_BUFFER;
  state.originalDispose();
  state.lease.release();
  delete geometry.userData[EXTERNAL_GEOMETRY_KEY];
}

function attribute(
  interleaved: THREE.InterleavedBuffer,
  layout: { readonly offsetFloats: number; readonly itemSize: number },
): THREE.InterleavedBufferAttribute {
  return new THREE.InterleavedBufferAttribute(
    interleaved,
    layout.itemSize,
    layout.offsetFloats,
    false,
  );
}

function recordResidentView(indirectEnabled: boolean): void {
  const counters = (globalThis as typeof globalThis & {
    window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
  }).window?.__drusnielClod?.stats?.counters;
  if (!counters) return;
  counters["live_clod_gpu_resident_render_views_total"] =
    (counters["live_clod_gpu_resident_render_views_total"] ?? 0) + 1;
  if (indirectEnabled) {
    counters["live_clod_gpu_indirect_render_views_total"] =
      (counters["live_clod_gpu_indirect_render_views_total"] ?? 0) + 1;
  }
}
