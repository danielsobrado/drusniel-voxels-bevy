// Transfer-only protocol for terrain collider BVH builds.

export type TerrainColliderIndexKind = "uint16" | "uint32";

export interface TerrainColliderWorkerBuildRequest {
  type: "build";
  requestId: number;
  positions: Float32Array;
  indices: Uint16Array | Uint32Array;
}

export type TerrainColliderWorkerRequest = TerrainColliderWorkerBuildRequest;

export interface TerrainColliderWorkerBuiltResponse {
  type: "built";
  requestId: number;
  roots: ArrayBuffer[];
  indexBuffer: ArrayBuffer;
  indexKind: TerrainColliderIndexKind;
  buildMs: number;
}

export interface TerrainColliderWorkerErrorResponse {
  type: "error";
  requestId: number | null;
  message: string;
}

export type TerrainColliderWorkerResponse =
  | TerrainColliderWorkerBuiltResponse
  | TerrainColliderWorkerErrorResponse;
