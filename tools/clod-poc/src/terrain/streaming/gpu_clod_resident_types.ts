import type { ClodPageNode } from "../../types.js";

export const GPU_CLOD_VERTEX_FLOATS = 16;
export const GPU_CLOD_VERTEX_STRIDE_BYTES = GPU_CLOD_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT;

export const GPU_CLOD_VERTEX_LAYOUT = {
  position: { offsetFloats: 0, itemSize: 3 },
  rootMorphDeltaY: { offsetFloats: 3, itemSize: 1 },
  normal: { offsetFloats: 4, itemSize: 3 },
  biomeId: { offsetFloats: 7, itemSize: 1 },
  paintSlots: { offsetFloats: 8, itemSize: 4 },
  paintWeights: { offsetFloats: 12, itemSize: 4 },
} as const;

export interface GpuClodMeshletBuffers {
  readonly headers: GPUBuffer;
  readonly bounds: GPUBuffer;
  readonly hierarchyHeaders: GPUBuffer;
  readonly hierarchyBounds: GPUBuffer;
  readonly indirect: GPUBuffer;
  readonly meshletCount: number;
  readonly hierarchyNodeCount: number;
  readonly byteLength: number;
}

export interface GpuClodResidentPage {
  readonly id: string;
  readonly revision: number;
  readonly level: number;
  readonly vertexBuffer: GPUBuffer;
  readonly indexBuffer: GPUBuffer;
  readonly vertexCount: number;
  readonly indexCount: number;
  readonly byteLength: number;
  readonly bounds: ClodPageNode["bounds"];
  readonly meshlets?: GpuClodMeshletBuffers;
  readonly errorWorld: number;
  readonly lowBenefit: boolean;
}

export interface GpuClodResidentPageLease {
  readonly page: GpuClodResidentPage;
  release(): void;
}

export function destroyGpuClodResidentPage(page: GpuClodResidentPage): void {
  page.vertexBuffer.destroy();
  page.indexBuffer.destroy();
  page.meshlets?.headers.destroy();
  page.meshlets?.bounds.destroy();
  page.meshlets?.hierarchyHeaders.destroy();
  page.meshlets?.hierarchyBounds.destroy();
  page.meshlets?.indirect.destroy();
}
