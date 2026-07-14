import * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";
import {
  GPU_CLOD_VERTEX_FLOATS,
  GPU_CLOD_VERTEX_LAYOUT,
  type GpuClodResidentPageLease,
} from "../terrain/streaming/gpu_clod_resident_types.js";

const EXTERNAL_GEOMETRY_KEY = "gpuClodExternalGeometry";
const INDEXED_INDIRECT_COMMAND_BYTES = 5 * Uint32Array.BYTES_PER_ELEMENT;

interface WebGpuBackendData {
  buffer?: GPUBuffer;
}

interface WebGpuBackendBridge {
  get(object: object): WebGpuBackendData;
}

interface ExternalGeometryState {
  lease: GpuClodResidentPageLease;
  released: boolean;
}

export function createExternalGpuClodGeometry(
  renderer: WebGPURenderer,
  lease: GpuClodResidentPageLease,
): THREE.BufferGeometry {
  const page = lease.page;
  const backend = renderer.backend as unknown as WebGpuBackendBridge;
  const geometry = new THREE.BufferGeometry();
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

  if (page.meshlets && page.meshlets.meshletCount > 0) {
    const indirect = new THREE.BufferAttribute(new Uint32Array(5), 1);
    geometry.indirect = indirect;
    geometry.indirectOffset = Array.from(
      { length: page.meshlets.meshletCount },
      (_, meshletIndex) => meshletIndex * INDEXED_INDIRECT_COMMAND_BYTES,
    );
    backend.get(indirect).buffer = page.meshlets.indirect;
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
  geometry.userData[EXTERNAL_GEOMETRY_KEY] = {
    lease,
    released: false,
  } satisfies ExternalGeometryState;
  return geometry;
}

export function isExternalGpuClodGeometry(geometry: THREE.BufferGeometry): boolean {
  return geometry.userData[EXTERNAL_GEOMETRY_KEY] !== undefined;
}

export function releaseExternalGpuClodGeometry(geometry: THREE.BufferGeometry): void {
  const state = geometry.userData[EXTERNAL_GEOMETRY_KEY] as ExternalGeometryState | undefined;
  if (!state || state.released) return;
  state.released = true;
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
