import { triangleCount, vertexCount, type ClodPageNode, type PageMesh, type PageFootprint } from "../../types.js";

export const STREAMED_PAGE_BOUNDS_GUARD_REASONS = [
  "unexpected_empty_mesh",
  "invalid_mesh_counts",
  "non_finite_position",
  "index_out_of_range",
  "invalid_bounds",
  "xz_out_of_bounds",
  "centroid_out_of_bounds",
  "xz_extent_too_large",
  "bounds_xz_mismatch",
  "y_out_of_bounds",
] as const;

export type StreamedPageBoundsGuardReason = typeof STREAMED_PAGE_BOUNDS_GUARD_REASONS[number];

export const STREAMED_PAGE_BOUNDS_GUARD_REASON_CODE: Record<StreamedPageBoundsGuardReason, number> = {
  unexpected_empty_mesh: 1,
  invalid_mesh_counts: 2,
  non_finite_position: 3,
  index_out_of_range: 4,
  invalid_bounds: 5,
  xz_out_of_bounds: 6,
  centroid_out_of_bounds: 7,
  xz_extent_too_large: 8,
  bounds_xz_mismatch: 9,
  y_out_of_bounds: 10,
};

export interface StreamedPageBoundsGuardConfig {
  enabled: boolean;
  marginXZ: number;
  centroidMarginXZ: number;
  maxExtentFootprintRatio: number;
  boundsMismatchMarginXZ: number;
  boundsYMargin: number;
  maxAbsY: number;
}

export interface StreamedPageBoundsGuardResult {
  ok: boolean;
  nodeId: string;
  reason?: StreamedPageBoundsGuardReason;
  reasonCode: number;
  vertexCount: number;
  triangleCount: number;
  overflowXZ: number;
  overflowY: number;
}

export interface StreamedPageBoundsGuardStats {
  enabled: number;
  checkedPages: number;
  rejectedPages: number;
  rejectedBatches: number;
  cacheDrops: number;
  cpuFallbackPages: number;
  maxOverflowXz: number;
  maxOverflowY: number;
  reasons: Record<StreamedPageBoundsGuardReason, number>;
}

export class StreamedPageBoundsGuardError extends Error {
  constructor(
    message: string,
    public readonly results: readonly StreamedPageBoundsGuardResult[],
  ) {
    super(message);
    this.name = "StreamedPageBoundsGuardError";
  }
}

export const DEFAULT_STREAMED_PAGE_BOUNDS_GUARD_CONFIG: StreamedPageBoundsGuardConfig = {
  enabled: false,
  marginXZ: 2,
  centroidMarginXZ: 2,
  maxExtentFootprintRatio: 1.25,
  boundsMismatchMarginXZ: 2,
  boundsYMargin: 64,
  maxAbsY: 8192,
};

export function streamedPageBoundsGuardConfigFromParams(
  params: URLSearchParams,
  defaults: StreamedPageBoundsGuardConfig = DEFAULT_STREAMED_PAGE_BOUNDS_GUARD_CONFIG,
): StreamedPageBoundsGuardConfig {
  return {
    enabled: booleanFlag(params, "liveClodRootBoundsGuard", defaults.enabled),
    marginXZ: nonNegativeNumber(params, "liveClodRootBoundsGuardMarginXZ", defaults.marginXZ),
    centroidMarginXZ: nonNegativeNumber(params, "liveClodRootBoundsGuardCentroidMarginXZ", defaults.centroidMarginXZ),
    maxExtentFootprintRatio: positiveNumber(params, "liveClodRootBoundsGuardMaxExtentRatio", defaults.maxExtentFootprintRatio),
    boundsMismatchMarginXZ: nonNegativeNumber(params, "liveClodRootBoundsGuardBoundsMarginXZ", defaults.boundsMismatchMarginXZ),
    boundsYMargin: nonNegativeNumber(params, "liveClodRootBoundsGuardYMargin", defaults.boundsYMargin),
    maxAbsY: positiveNumber(params, "liveClodRootBoundsGuardMaxAbsY", defaults.maxAbsY),
  };
}

export function streamedPageBoundsGuardConfigFromWindow(): StreamedPageBoundsGuardConfig {
  const maybeWindow = (globalThis as typeof globalThis & { window?: { location?: { search?: string } } }).window;
  return streamedPageBoundsGuardConfigFromParams(new URLSearchParams(maybeWindow?.location?.search ?? ""));
}

export function createStreamedPageBoundsGuardStats(): StreamedPageBoundsGuardStats {
  return {
    enabled: 0,
    checkedPages: 0,
    rejectedPages: 0,
    rejectedBatches: 0,
    cacheDrops: 0,
    cpuFallbackPages: 0,
    maxOverflowXz: 0,
    maxOverflowY: 0,
    reasons: zeroReasons(),
  };
}

export function validateStreamedPageBounds(
  node: ClodPageNode,
  chunkSize: number,
  config: StreamedPageBoundsGuardConfig,
): StreamedPageBoundsGuardResult {
  const vertices = vertexCount(node.mesh);
  const triangles = triangleCount(node.mesh);
  const disabled: StreamedPageBoundsGuardResult = {
    ok: true,
    nodeId: node.id,
    reasonCode: 0,
    vertexCount: vertices,
    triangleCount: triangles,
    overflowXZ: 0,
    overflowY: 0,
  };
  if (!config.enabled) return disabled;

  if (!validMeshShape(node.mesh)) return reject(node, "invalid_mesh_counts", vertices, triangles);
  if (vertices === 0 || triangles === 0) return reject(node, "unexpected_empty_mesh", vertices, triangles);
  if (!validBounds(node.bounds)) return reject(node, "invalid_bounds", vertices, triangles);
  const nonFinite = firstNonFinitePosition(node.mesh.positions);
  if (nonFinite >= 0) return reject(node, "non_finite_position", vertices, triangles);
  if (firstOutOfRangeIndex(node.mesh.indices, vertices) >= 0) return reject(node, "index_out_of_range", vertices, triangles);

  const footprint = normalizedFootprint(node.footprint);
  const meshBounds = xzBounds(node.mesh);
  const expectedSpanX = Math.max(1, footprint.maxX - footprint.minX);
  const expectedSpanZ = Math.max(1, footprint.maxZ - footprint.minZ);
  const overflowXZ = footprintOverflow(meshBounds.minX, meshBounds.maxX, meshBounds.minZ, meshBounds.maxZ, footprint, config.marginXZ);
  if (overflowXZ > 0) return reject(node, "xz_out_of_bounds", vertices, triangles, overflowXZ);

  const boundsOverflow = footprintOverflow(node.bounds.center[0], node.bounds.center[0], node.bounds.center[2], node.bounds.center[2], footprint, config.boundsMismatchMarginXZ + node.bounds.radius);
  if (boundsOverflow > 0) return reject(node, "bounds_xz_mismatch", vertices, triangles, boundsOverflow);

  const centroid = meshCentroid(node.mesh);
  const centroidOverflow = footprintOverflow(centroid.x, centroid.x, centroid.z, centroid.z, footprint, config.centroidMarginXZ);
  if (centroidOverflow > 0) return reject(node, "centroid_out_of_bounds", vertices, triangles, centroidOverflow);

  const extentX = meshBounds.maxX - meshBounds.minX;
  const extentZ = meshBounds.maxZ - meshBounds.minZ;
  const extentOverflow = Math.max(
    0,
    extentX - expectedSpanX * config.maxExtentFootprintRatio,
    extentZ - expectedSpanZ * config.maxExtentFootprintRatio,
  );
  if (extentOverflow > 0) return reject(node, "xz_extent_too_large", vertices, triangles, extentOverflow);

  const y = yBounds(node.mesh);
  const overflowY = Math.max(
    0,
    y.maxY - (node.bounds.maxY + config.boundsYMargin),
    node.bounds.minY - config.boundsYMargin - y.minY,
    Math.abs(y.maxY) - config.maxAbsY,
    Math.abs(y.minY) - config.maxAbsY,
  );
  if (overflowY > 0) return reject(node, "y_out_of_bounds", vertices, triangles, 0, overflowY);

  void chunkSize;
  return disabled;
}

export function recordStreamedPageBoundsGuardResult(
  stats: StreamedPageBoundsGuardStats,
  result: StreamedPageBoundsGuardResult,
  config: StreamedPageBoundsGuardConfig,
): void {
  stats.enabled = config.enabled ? 1 : 0;
  if (!config.enabled) return;
  stats.checkedPages++;
  stats.maxOverflowXz = Math.max(stats.maxOverflowXz, result.overflowXZ);
  stats.maxOverflowY = Math.max(stats.maxOverflowY, result.overflowY);
  if (result.ok || !result.reason) return;
  stats.rejectedPages++;
  stats.reasons[result.reason] = (stats.reasons[result.reason] ?? 0) + 1;
}

export function recordStreamedPageBoundsGuardBatchReject(stats: StreamedPageBoundsGuardStats): void {
  stats.rejectedBatches++;
}

export function recordStreamedPageBoundsGuardCacheDrop(stats: StreamedPageBoundsGuardStats): void {
  stats.cacheDrops++;
}

export function recordStreamedPageBoundsGuardCpuFallbackPages(stats: StreamedPageBoundsGuardStats, count: number): void {
  stats.cpuFallbackPages += Math.max(0, Math.floor(count));
}

export function validateStreamedPageBoundsBatch(
  nodes: readonly ClodPageNode[],
  chunkSize: number,
  config: StreamedPageBoundsGuardConfig,
): StreamedPageBoundsGuardResult[] {
  return nodes.map((node) => validateStreamedPageBounds(node, chunkSize, config));
}

export function publishStreamedPageBoundsGuardStatsToCounters(
  counters: Record<string, number> | undefined,
  stats: StreamedPageBoundsGuardStats,
): void {
  if (!counters) return;
  counters["live_clod_stream_bounds_guard_enabled"] = stats.enabled;
  counters["live_clod_stream_bounds_guard_checked_pages"] = stats.checkedPages;
  counters["live_clod_stream_bounds_guard_rejected_pages"] = stats.rejectedPages;
  counters["live_clod_stream_bounds_guard_rejected_batches"] = stats.rejectedBatches;
  counters["live_clod_stream_bounds_guard_cache_drops"] = stats.cacheDrops;
  counters["live_clod_stream_bounds_guard_cpu_fallback_pages"] = stats.cpuFallbackPages;
  counters["live_clod_stream_bounds_guard_max_overflow_xz"] = stats.maxOverflowXz;
  counters["live_clod_stream_bounds_guard_max_overflow_y"] = stats.maxOverflowY;
  for (const reason of STREAMED_PAGE_BOUNDS_GUARD_REASONS) {
    counters[`live_clod_stream_bounds_guard_reason_${reason}`] = stats.reasons[reason] ?? 0;
  }
}

export function isStreamedPageBoundsGuardError(error: unknown): error is StreamedPageBoundsGuardError {
  return error instanceof StreamedPageBoundsGuardError || (error instanceof Error && error.name === "StreamedPageBoundsGuardError");
}

function reject(
  node: ClodPageNode,
  reason: StreamedPageBoundsGuardReason,
  vertices: number,
  triangles: number,
  overflowXZ = 0,
  overflowY = 0,
): StreamedPageBoundsGuardResult {
  return {
    ok: false,
    nodeId: node.id,
    reason,
    reasonCode: STREAMED_PAGE_BOUNDS_GUARD_REASON_CODE[reason],
    vertexCount: vertices,
    triangleCount: triangles,
    overflowXZ: Math.max(0, overflowXZ),
    overflowY: Math.max(0, overflowY),
  };
}

function booleanFlag(params: URLSearchParams, key: string, fallback: boolean): boolean {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return fallback;
  if (raw === "1" || raw.toLowerCase() === "true") return true;
  if (raw === "0" || raw.toLowerCase() === "false") return false;
  return fallback;
}

function nonNegativeNumber(params: URLSearchParams, key: string, fallback: number): number {
  const parsed = Number(params.get(key));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function positiveNumber(params: URLSearchParams, key: string, fallback: number): number {
  const parsed = Number(params.get(key));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function zeroReasons(): Record<StreamedPageBoundsGuardReason, number> {
  return Object.fromEntries(STREAMED_PAGE_BOUNDS_GUARD_REASONS.map((reason) => [reason, 0])) as Record<StreamedPageBoundsGuardReason, number>;
}

function validMeshShape(mesh: PageMesh): boolean {
  const vertices = vertexCount(mesh);
  return Number.isInteger(vertices)
    && mesh.positions.length % 3 === 0
    && mesh.indices.length % 3 === 0
    && mesh.normals.length === mesh.positions.length
    && mesh.paintSlots.length === vertices
    && mesh.materialWeightStride > 0
    && mesh.materialWeights.length === vertices * mesh.materialWeightStride;
}

function validBounds(bounds: ClodPageNode["bounds"]): boolean {
  return Number.isFinite(bounds.center[0])
    && Number.isFinite(bounds.center[1])
    && Number.isFinite(bounds.center[2])
    && Number.isFinite(bounds.radius)
    && bounds.radius >= 0
    && Number.isFinite(bounds.minY)
    && Number.isFinite(bounds.maxY)
    && bounds.minY <= bounds.maxY;
}

function firstNonFinitePosition(positions: Float32Array): number {
  for (let i = 0; i < positions.length; i++) if (!Number.isFinite(positions[i])) return i;
  return -1;
}

function firstOutOfRangeIndex(indices: Uint32Array, vertices: number): number {
  for (let i = 0; i < indices.length; i++) if (indices[i] >= vertices) return i;
  return -1;
}

function normalizedFootprint(footprint: PageFootprint): PageFootprint {
  return {
    minX: Math.min(footprint.minX, footprint.maxX),
    minZ: Math.min(footprint.minZ, footprint.maxZ),
    maxX: Math.max(footprint.minX, footprint.maxX),
    maxZ: Math.max(footprint.minZ, footprint.maxZ),
  };
}

function xzBounds(mesh: PageMesh): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    minX = Math.min(minX, mesh.positions[i]);
    maxX = Math.max(maxX, mesh.positions[i]);
    minZ = Math.min(minZ, mesh.positions[i + 2]);
    maxZ = Math.max(maxZ, mesh.positions[i + 2]);
  }
  return { minX, maxX, minZ, maxZ };
}

function yBounds(mesh: PageMesh): { minY: number; maxY: number } {
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 1; i < mesh.positions.length; i += 3) {
    minY = Math.min(minY, mesh.positions[i]);
    maxY = Math.max(maxY, mesh.positions[i]);
  }
  return { minY, maxY };
}

function meshCentroid(mesh: PageMesh): { x: number; z: number } {
  let x = 0;
  let z = 0;
  const vertices = vertexCount(mesh);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    x += mesh.positions[i];
    z += mesh.positions[i + 2];
  }
  return { x: x / vertices, z: z / vertices };
}

function footprintOverflow(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  footprint: PageFootprint,
  margin: number,
): number {
  return Math.max(
    0,
    footprint.minX - margin - minX,
    maxX - (footprint.maxX + margin),
    footprint.minZ - margin - minZ,
    maxZ - (footprint.maxZ + margin),
  );
}
