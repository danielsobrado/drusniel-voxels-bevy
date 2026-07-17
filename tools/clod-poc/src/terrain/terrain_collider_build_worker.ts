// Terrain collider BVH worker. MeshBVH construction and serialization stay off the main thread.

import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import type {
  TerrainColliderWorkerRequest,
  TerrainColliderWorkerResponse,
} from "./terrain_collider_worker_protocol.js";

const ctx = self as unknown as {
  postMessage: (message: TerrainColliderWorkerResponse, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent<TerrainColliderWorkerRequest>) => void) | null;
};

function build(request: Extract<TerrainColliderWorkerRequest, { type: "build" }>): void {
  const startedAt = performance.now();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(request.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(request.indices, 1));
  geometry.computeBoundingBox();

  const bvh = new MeshBVH(geometry);
  const serialized = MeshBVH.serialize(bvh, { cloneBuffers: false });
  const index = serialized.index;
  if (!(index instanceof Uint16Array) && !(index instanceof Uint32Array)) {
    throw new Error("Unsupported collider BVH index type");
  }

  const indexBuffer = index.buffer as ArrayBuffer;
  const roots = serialized.roots;
  ctx.postMessage({
    type: "built",
    requestId: request.requestId,
    roots,
    indexBuffer,
    indexKind: index instanceof Uint16Array ? "uint16" : "uint32",
    buildMs: performance.now() - startedAt,
  }, [...roots, indexBuffer]);
  geometry.dispose();
}

ctx.onmessage = (event: MessageEvent<TerrainColliderWorkerRequest>) => {
  const request = event.data;
  try {
    build(request);
  } catch (error) {
    ctx.postMessage({
      type: "error",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
