import { computeMeshDims } from "../../gpu/gpu_mesh_buffers.js";

export interface RootBatchRequest {
  px: number;
  pz: number;
  level?: number;
}

export interface RootBatchPageConfig {
  chunks_per_page: number;
  chunk_size: number;
  quadtree_levels: number;
}

export interface GpuRootChunkPlan {
  slotIndex: number;
  requestIndex: number;
  rootLevel: number;
  rootPx: number;
  rootPz: number;
  lod0Px: number;
  lod0Pz: number;
  localChunkIndex: number;
  cx: number;
  cz: number;
}

export interface RootGpuBatchLimits {
  batchSize: number;
  maxChunkSlots: number;
  maxTotalSlotBytes: number;
  maxReadbackBufferBytes?: number;
}

export interface ChunkSlotByteEstimate {
  slotCount: number;
  maxVertices: number;
  maxIndices: number;
  slotBufferBytes: number;
  readbackBytes: number;
  totalBytes: number;
}

export interface ChunkReadbackCounts {
  slotIndex: number;
  vertexCount: number;
  indexCount: number;
}

export interface ChunkReadbackRange {
  slotIndex: number;
  vertexCount: number;
  indexCount: number;
  positionsOffset: number;
  positionsBytes: number;
  normalsOffset: number;
  normalsBytes: number;
  materialsOffset: number;
  materialsBytes: number;
  indicesOffset: number;
  indicesBytes: number;
}

export interface GeometryReadbackLayout {
  ranges: ChunkReadbackRange[];
  positionsBytes: number;
  normalsBytes: number;
  materialsBytes: number;
  indicesBytes: number;
}

export class RootGpuBatchLimitError extends Error {
  constructor(
    message: string,
    readonly request: RootBatchRequest,
    readonly slots: number,
    readonly bytes: number,
    readonly limits: RootGpuBatchLimits,
  ) {
    super(message);
    this.name = "RootGpuBatchLimitError";
  }
}

const F32 = Float32Array.BYTES_PER_ELEMENT;
const U32 = Uint32Array.BYTES_PER_ELEMENT;
const READBACK_HEADROOM_MULTIPLIER = 3;

export function rootLevelForRequest(request: RootBatchRequest, cfg: { quadtree_levels: number }): number {
  return Math.max(0, Math.min(Math.max(0, Math.floor(cfg.quadtree_levels) - 1), Math.floor(request.level ?? 0)));
}

export function chunkSlotsPerRootPage(chunksPerPage: number, rootLevel: number): number {
  const pageChunks = Math.max(1, Math.floor(chunksPerPage)) ** 2;
  return pageChunks * 4 ** Math.max(0, Math.floor(rootLevel));
}

export function estimateChunkSlotBytes(chunkSize: number): ChunkSlotByteEstimate {
  const dims = computeMeshDims(0, 0, Math.max(1, Math.floor(chunkSize)));
  const positionsBytes = dims.maxVertices * 3 * F32;
  const normalsBytes = dims.maxVertices * 3 * F32;
  const materialsBytes = dims.maxVertices * F32;
  const cellIndexBytes = dims.slotCount * U32;
  const indicesBytes = dims.maxIndices * U32;
  const counterBytes = U32 + U32;
  const slotBufferBytes = positionsBytes
    + normalsBytes
    + materialsBytes
    + cellIndexBytes
    + indicesBytes
    + counterBytes;
  return {
    slotCount: dims.slotCount,
    maxVertices: dims.maxVertices,
    maxIndices: dims.maxIndices,
    slotBufferBytes,
    readbackBytes: positionsBytes + normalsBytes + materialsBytes + indicesBytes,
    totalBytes: slotBufferBytes * READBACK_HEADROOM_MULTIPLIER,
  };
}

export function estimateRootRequestSlotBytes(request: RootBatchRequest, cfg: RootBatchPageConfig): number {
  return chunkSlotsPerRootPage(cfg.chunks_per_page, rootLevelForRequest(request, cfg)) * estimateChunkSlotBytes(cfg.chunk_size).totalBytes;
}

export function estimateRootRequestReadbackBytes(request: RootBatchRequest, cfg: RootBatchPageConfig): number {
  return chunkSlotsPerRootPage(cfg.chunks_per_page, rootLevelForRequest(request, cfg)) * estimateChunkSlotBytes(cfg.chunk_size).readbackBytes;
}

export function planRootBatchChunkSlots(
  requests: readonly RootBatchRequest[],
  cfg: RootBatchPageConfig,
): GpuRootChunkPlan[] {
  const plans: GpuRootChunkPlan[] = [];
  const chunksPerPage = Math.max(1, Math.floor(cfg.chunks_per_page));
  for (let requestIndex = 0; requestIndex < requests.length; requestIndex++) {
    const request = requests[requestIndex]!;
    const rootLevel = rootLevelForRequest(request, cfg);
    const lod0Scale = 2 ** rootLevel;
    const lod0BaseX = request.px * lod0Scale;
    const lod0BaseZ = request.pz * lod0Scale;
    for (let pageDz = 0; pageDz < lod0Scale; pageDz++) {
      for (let pageDx = 0; pageDx < lod0Scale; pageDx++) {
        const lod0Px = lod0BaseX + pageDx;
        const lod0Pz = lod0BaseZ + pageDz;
        for (let localChunkIndex = 0; localChunkIndex < chunksPerPage * chunksPerPage; localChunkIndex++) {
          const dx = localChunkIndex % chunksPerPage;
          const dz = Math.floor(localChunkIndex / chunksPerPage);
          plans.push({
            slotIndex: plans.length,
            requestIndex,
            rootLevel,
            rootPx: request.px,
            rootPz: request.pz,
            lod0Px,
            lod0Pz,
            localChunkIndex,
            cx: lod0Px * chunksPerPage + dx,
            cz: lod0Pz * chunksPerPage + dz,
          });
        }
      }
    }
  }
  return plans;
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! > 0 ? Math.floor(value!) : fallback;
}

export function splitRootGpuBatches<T extends RootBatchRequest>(
  requests: readonly T[],
  cfg: RootBatchPageConfig,
  limits: RootGpuBatchLimits,
): T[][] {
  const batches: T[][] = [];
  const maxPages = Math.max(1, Math.floor(limits.batchSize));
  const maxChunkSlots = Math.max(1, Math.floor(limits.maxChunkSlots));
  const maxTotalSlotBytes = Math.max(1, Math.floor(limits.maxTotalSlotBytes));
  const maxReadbackBufferBytes = positiveLimit(limits.maxReadbackBufferBytes, Number.POSITIVE_INFINITY);
  const normalizedLimits: RootGpuBatchLimits = {
    batchSize: maxPages,
    maxChunkSlots,
    maxTotalSlotBytes,
    maxReadbackBufferBytes,
  };
  let current: T[] = [];
  let currentSlots = 0;
  let currentBytes = 0;
  let currentReadbackBytes = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    batches.push(current);
    current = [];
    currentSlots = 0;
    currentBytes = 0;
    currentReadbackBytes = 0;
  };

  for (const request of requests) {
    const rootLevel = rootLevelForRequest(request, cfg);
    const slots = chunkSlotsPerRootPage(cfg.chunks_per_page, rootLevel);
    const bytes = estimateRootRequestSlotBytes(request, cfg);
    const readbackBytes = estimateRootRequestReadbackBytes(request, cfg);
    const oversized = slots > maxChunkSlots || bytes > maxTotalSlotBytes || readbackBytes > maxReadbackBufferBytes;
    if (oversized) {
      throw new RootGpuBatchLimitError(
        `GPU streamed-root request L${rootLevel}:${request.px},${request.pz} requires ${slots} chunk slots, ${bytes} total bytes, and ${readbackBytes} readback bytes, above limits ${maxChunkSlots}/${maxTotalSlotBytes}/${maxReadbackBufferBytes}`,
        request,
        slots,
        Math.max(bytes, readbackBytes),
        normalizedLimits,
      );
    }
    const wouldExceed =
      current.length >= maxPages ||
      currentSlots + slots > maxChunkSlots ||
      currentBytes + bytes > maxTotalSlotBytes ||
      currentReadbackBytes + readbackBytes > maxReadbackBufferBytes;
    if (current.length > 0 && wouldExceed) flush();
    current.push(request);
    currentSlots += slots;
    currentBytes += bytes;
    currentReadbackBytes += readbackBytes;
    if (current.length >= maxPages) flush();
  }
  flush();
  return batches;
}

export function planGeometryReadbackLayout(counts: readonly ChunkReadbackCounts[]): GeometryReadbackLayout {
  let positionsBytes = 0;
  let normalsBytes = 0;
  let materialsBytes = 0;
  let indicesBytes = 0;
  const ranges = counts.map((count) => {
    const vertexCount = Math.max(0, Math.floor(count.vertexCount));
    const indexCount = Math.max(0, Math.floor(count.indexCount));
    const range: ChunkReadbackRange = {
      slotIndex: count.slotIndex,
      vertexCount,
      indexCount,
      positionsOffset: positionsBytes,
      positionsBytes: vertexCount * 3 * F32,
      normalsOffset: normalsBytes,
      normalsBytes: vertexCount * 3 * F32,
      materialsOffset: materialsBytes,
      materialsBytes: vertexCount * F32,
      indicesOffset: indicesBytes,
      indicesBytes: indexCount * U32,
    };
    positionsBytes += range.positionsBytes;
    normalsBytes += range.normalsBytes;
    materialsBytes += range.materialsBytes;
    indicesBytes += range.indicesBytes;
    return range;
  });
  return { ranges, positionsBytes, normalsBytes, materialsBytes, indicesBytes };
}
