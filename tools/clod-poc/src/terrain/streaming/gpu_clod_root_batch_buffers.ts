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
  /** Vertical window base in cells; omitted means the default near-surface window (-1). */
  vyBase?: number;
}

/**
 * Matches the CPU chunk mesher's MIN_Y_CELL. A page whose whole surface lies below the
 * default [-1, Y_CELLS] window (deep ocean at the continent rims) meshes empty on the
 * GPU; retrying with the window floor at -64 covers every height the CPU mesher can
 * produce for such pages.
 */
export const DEEP_WINDOW_RETRY_VY_BASE = -64;
const DEFAULT_WINDOW_FLOOR_SURFACE_Y = 0;
const DEEP_WINDOW_SAFE_MAX_Y = 63;

/** LOD0 page keys (`px,pz`) whose every chunk in `meshesBySlot` has zero indices. */
export function fullyEmptyLod0PageKeys(
  plans: readonly GpuRootChunkPlan[],
  meshesBySlot: ReadonlyMap<number, { indices: { length: number } }>,
): Set<string> {
  const nonEmpty = new Set<string>();
  const seen = new Set<string>();
  for (const plan of plans) {
    const key = `${plan.lod0Px},${plan.lod0Pz}`;
    seen.add(key);
    if ((meshesBySlot.get(plan.slotIndex)?.indices.length ?? 0) > 0) nonEmpty.add(key);
  }
  const empty = new Set<string>();
  for (const key of seen) if (!nonEmpty.has(key)) empty.add(key);
  return empty;
}

/**
 * LOD0 pages with real geometry intersecting the lower edge of the default GPU window.
 * Rebuild only pages whose observed top stays inside the lowered window, so the retry cannot
 * trade a clipped seafloor for a clipped hilltop.
 */
export function partiallyFloorClippedLod0PageKeys(
  plans: readonly GpuRootChunkPlan[],
  meshesBySlot: ReadonlyMap<number, { positions: ArrayLike<number>; indices: ArrayLike<number> }>,
  chunkSize: number,
): Set<string> {
  const ranges = new Map<string, { minY: number; maxY: number }>();
  const floorContourPages = new Set<string>();
  for (const plan of plans) {
    const mesh = meshesBySlot.get(plan.slotIndex);
    const positions = mesh?.positions;
    if (!mesh || !positions || positions.length < 3) continue;
    const key = `${plan.lod0Px},${plan.lod0Pz}`;
    const range = ranges.get(key) ?? { minY: Number.POSITIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY };
    for (let index = 1; index < positions.length; index += 3) {
      const y = Number(positions[index]);
      if (!Number.isFinite(y)) continue;
      range.minY = Math.min(range.minY, y);
      range.maxY = Math.max(range.maxY, y);
    }
    ranges.set(key, range);
    const edgeCounts = new Map<string, number>();
    for (let index = 0; index + 2 < mesh.indices.length; index += 3) {
      const triangle = [Number(mesh.indices[index]), Number(mesh.indices[index + 1]), Number(mesh.indices[index + 2])];
      for (const [a, b] of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]]) {
        const edge = a! < b! ? `${a}:${b}` : `${b}:${a}`;
        edgeCounts.set(edge, (edgeCounts.get(edge) ?? 0) + 1);
      }
    }
    const boundaryVertices = new Set<number>();
    for (const [edge, count] of edgeCounts) {
      if (count !== 1) continue;
      for (const vertex of edge.split(":").map(Number)) boundaryVertices.add(vertex);
    }
    const x0 = plan.cx * chunkSize;
    const x1 = x0 + chunkSize;
    const z0 = plan.cz * chunkSize;
    const z1 = z0 + chunkSize;
    for (const vertex of boundaryVertices) {
      const x = Number(positions[vertex * 3]);
      const y = Number(positions[vertex * 3 + 1]);
      const z = Number(positions[vertex * 3 + 2]);
      const perimeterDistance = Math.min(Math.abs(x - x0), Math.abs(x - x1), Math.abs(z - z0), Math.abs(z - z1));
      if (y <= DEFAULT_WINDOW_FLOOR_SURFACE_Y && perimeterDistance > 1) {
        floorContourPages.add(key);
        break;
      }
    }
  }
  const clipped = new Set<string>();
  for (const [key, range] of ranges) {
    if (floorContourPages.has(key) && range.maxY <= DEEP_WINDOW_SAFE_MAX_Y) clipped.add(key);
  }
  return clipped;
}

/** Rebased copies of the plans for `pageKeys`, stamped with the lowered vertical window. */
export function deepWindowRetryPlans(
  plans: readonly GpuRootChunkPlan[],
  pageKeys: ReadonlySet<string>,
): GpuRootChunkPlan[] {
  return plans
    .filter((plan) => pageKeys.has(`${plan.lod0Px},${plan.lod0Pz}`))
    .map((plan, slotIndex) => ({ ...plan, slotIndex, vyBase: DEEP_WINDOW_RETRY_VY_BASE }));
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
  const readbackBytes = positionsBytes + normalsBytes + materialsBytes + indicesBytes;
  return {
    slotCount: dims.slotCount,
    maxVertices: dims.maxVertices,
    maxIndices: dims.maxIndices,
    slotBufferBytes,
    readbackBytes,
    totalBytes: slotBufferBytes + readbackBytes * READBACK_HEADROOM_MULTIPLIER,
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

export interface ChunkBoundsViolation {
  outCount: number;
  firstIndex: number;
  x: number;
  y: number;
  z: number;
}

/**
 * Find GPU-produced chunk vertices whose X/Z fall outside the chunk's own cell bounds (plus a small
 * halo). A correct surface-nets chunk at cells [x0,x1]x[z0,z1] can only place vertices within about
 * one cell of that box; a vertex hundreds of cells away is stale/garbage GPU pool data being read as
 * this chunk's geometry (which renders as a stretched triangle). Returns the first offender and the
 * total count, or null when the chunk is in bounds. Pure, for unit testing the guard.
 */
export function findChunkVerticesOutOfBounds(
  positions: Float32Array | readonly number[],
  vertexCount: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): ChunkBoundsViolation | null {
  let outCount = 0;
  let firstIndex = -1;
  let fx = 0;
  let fy = 0;
  let fz = 0;
  for (let i = 0; i < vertexCount; i++) {
    const x = positions[i * 3];
    const z = positions[i * 3 + 2];
    if (x < minX || x > maxX || z < minZ || z > maxZ) {
      if (firstIndex < 0) {
        firstIndex = i;
        fx = x;
        fy = positions[i * 3 + 1];
        fz = z;
      }
      outCount++;
    }
  }
  return outCount > 0 ? { outCount, firstIndex, x: fx, y: fy, z: fz } : null;
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
