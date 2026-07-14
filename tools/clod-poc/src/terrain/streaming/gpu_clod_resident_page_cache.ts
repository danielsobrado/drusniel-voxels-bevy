import type { ClodPageNode, PageMesh } from "../../types.js";
import { biomeIdsFor, paintAttributesFor } from "../geometry/page_geometry.js";
import type { GpuClodHierarchyConfig } from "./gpu_clod_hierarchy_config.js";
import {
  registerGpuClodResidentPage,
  retireGpuClodResidentPage,
} from "./gpu_clod_resident_registry.js";
import {
  GPU_CLOD_VERTEX_FLOATS,
  destroyGpuClodResidentPage,
  type GpuClodResidentPage,
} from "./gpu_clod_resident_types.js";

export type { GpuClodResidentPage } from "./gpu_clod_resident_types.js";

const MIN_BUFFER_BYTES = 4;
const F32 = Float32Array.BYTES_PER_ELEMENT;
const U32 = Uint32Array.BYTES_PER_ELEMENT;

export interface GpuClodResidentPageCacheStats {
  enabled: number;
  residentPages: number;
  residentBytes: number;
  uploadsTotal: number;
  uploadBytesTotal: number;
  adoptedPagesTotal: number;
  evictionsTotal: number;
  meshletsResident: number;
  hierarchyNodesResident: number;
}

interface ResidentEntry {
  page: GpuClodResidentPage;
  sourceMesh: PageMesh | null;
  lastTouch: number;
}

export class GpuClodResidentPageCache {
  private readonly entries = new Map<string, ResidentEntry>();
  private residentBytes = 0;
  private uploadsTotal = 0;
  private uploadBytesTotal = 0;
  private adoptedPagesTotal = 0;
  private evictionsTotal = 0;
  private clock = 0;
  private disposed = false;

  constructor(
    private readonly device: GPUDevice,
    private readonly config: GpuClodHierarchyConfig,
  ) {
    this.publishCounters();
  }

  ingest(nodes: readonly ClodPageNode[]): void {
    if (!this.config.enabled || this.disposed) return;
    for (const node of nodes) {
      if (node.level > this.config.residentMaxLevel || node.mesh.indices.length === 0) continue;
      this.upsertCpuNode(node);
    }
    this.evictToBudget(new Set());
    this.publishCounters();
  }

  adopt(page: GpuClodResidentPage): void {
    this.adoptMany([page]);
  }

  adoptMany(pages: readonly GpuClodResidentPage[]): void {
    if (pages.length === 0) return;
    if (!this.config.enabled || this.disposed) {
      for (const page of pages) destroyGpuClodResidentPage(page);
      return;
    }

    const protectedIds = new Set<string>();
    let protectedBytes = 0;
    for (const page of pages) {
      if (page.level > this.config.residentMaxLevel) {
        throw new Error(
          `GPU CLOD resident page ${page.id} level ${page.level} exceeds configured max ${this.config.residentMaxLevel}`,
        );
      }
      if (protectedIds.has(page.id)) throw new Error(`duplicate GPU CLOD resident page ${page.id} in one batch`);
      protectedIds.add(page.id);
      protectedBytes += page.byteLength;
    }

    const budget = this.budgetBytes();
    if (protectedBytes > budget) {
      throw new Error(`GPU CLOD resident batch needs ${protectedBytes} bytes, budget is ${budget}`);
    }

    for (const page of pages) this.replace(page, null);
    this.adoptedPagesTotal += pages.length;
    this.evictToBudget(protectedIds);
    if (this.residentBytes > budget) {
      throw new Error(`GPU CLOD resident cache could not satisfy ${budget}-byte budget without evicting the active batch`);
    }
    this.publishCounters();
  }

  get(nodeId: string): GpuClodResidentPage | undefined {
    const entry = this.entries.get(nodeId);
    if (!entry) return undefined;
    entry.lastTouch = ++this.clock;
    return entry.page;
  }

  has(nodeId: string, revision?: number): boolean {
    const entry = this.entries.get(nodeId);
    if (!entry) return false;
    return revision === undefined || entry.page.revision === revision;
  }

  remove(nodeId: string): void {
    const entry = this.entries.get(nodeId);
    if (!entry) return;
    this.entries.delete(nodeId);
    retireGpuClodResidentPage(nodeId, entry.page);
    this.residentBytes -= entry.page.byteLength;
    this.publishCounters();
  }

  stats(): GpuClodResidentPageCacheStats {
    let meshletsResident = 0;
    let hierarchyNodesResident = 0;
    for (const entry of this.entries.values()) {
      meshletsResident += entry.page.meshlets?.meshletCount ?? 0;
      hierarchyNodesResident += entry.page.meshlets?.hierarchyNodeCount ?? 0;
    }
    return {
      enabled: this.config.enabled ? 1 : 0,
      residentPages: this.entries.size,
      residentBytes: Math.max(0, this.residentBytes),
      uploadsTotal: this.uploadsTotal,
      uploadBytesTotal: this.uploadBytesTotal,
      adoptedPagesTotal: this.adoptedPagesTotal,
      evictionsTotal: this.evictionsTotal,
      meshletsResident,
      hierarchyNodesResident,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [nodeId, entry] of this.entries) retireGpuClodResidentPage(nodeId, entry.page);
    this.entries.clear();
    this.residentBytes = 0;
    this.publishCounters();
  }

  private upsertCpuNode(node: ClodPageNode): void {
    const revision = normalizedRevision(node.revision);
    const existing = this.entries.get(node.id);
    if (existing?.page.revision === revision && existing.sourceMesh === node.mesh) {
      existing.lastTouch = ++this.clock;
      return;
    }
    const page = this.uploadCpuNode(node, revision);
    this.replace(page, node.mesh);
    this.uploadsTotal++;
    this.uploadBytesTotal += page.byteLength;
  }

  private replace(page: GpuClodResidentPage, sourceMesh: PageMesh | null): void {
    const existing = this.entries.get(page.id);
    if (existing) {
      this.entries.delete(page.id);
      retireGpuClodResidentPage(page.id, existing.page);
      this.residentBytes -= existing.page.byteLength;
    }
    this.entries.set(page.id, { page, sourceMesh, lastTouch: ++this.clock });
    this.residentBytes += page.byteLength;
    registerGpuClodResidentPage(page);
  }

  private uploadCpuNode(node: ClodPageNode, revision: number): GpuClodResidentPage {
    const vertexCount = node.mesh.positions.length / 3;
    const packed = new Float32Array(vertexCount * GPU_CLOD_VERTEX_FLOATS);
    const paint = paintAttributesFor(node.mesh);
    const biomeIds = biomeIdsFor(node.mesh);
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const source3 = vertex * 3;
      const source4 = vertex * 4;
      const target = vertex * GPU_CLOD_VERTEX_FLOATS;
      packed[target] = node.mesh.positions[source3] ?? 0;
      packed[target + 1] = node.mesh.positions[source3 + 1] ?? 0;
      packed[target + 2] = node.mesh.positions[source3 + 2] ?? 0;
      packed[target + 3] = 0;
      packed[target + 4] = node.mesh.normals[source3] ?? 0;
      packed[target + 5] = node.mesh.normals[source3 + 1] ?? 1;
      packed[target + 6] = node.mesh.normals[source3 + 2] ?? 0;
      packed[target + 7] = biomeIds[vertex] ?? 0;
      packed[target + 8] = paint.slots[source4] ?? -1;
      packed[target + 9] = paint.slots[source4 + 1] ?? -1;
      packed[target + 10] = paint.slots[source4 + 2] ?? -1;
      packed[target + 11] = paint.slots[source4 + 3] ?? -1;
      packed[target + 12] = paint.weights[source4] ?? 0;
      packed[target + 13] = paint.weights[source4 + 1] ?? 0;
      packed[target + 14] = paint.weights[source4 + 2] ?? 0;
      packed[target + 15] = paint.weights[source4 + 3] ?? 0;
    }
    const vertexBuffer = this.upload(
      "vertices",
      node.id,
      packed,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | GPUBufferUsage.VERTEX,
    );
    const indexBuffer = this.upload(
      "indices",
      node.id,
      node.mesh.indices,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | GPUBufferUsage.INDEX,
    );
    return {
      id: node.id,
      revision,
      level: node.level,
      vertexBuffer,
      indexBuffer,
      vertexCount,
      indexCount: node.mesh.indices.length,
      byteLength: packed.byteLength + node.mesh.indices.byteLength,
      bounds: node.bounds,
      errorWorld: node.errorWorld,
      lowBenefit: node.lowBenefit,
    };
  }

  private upload(label: string, nodeId: string, data: Float32Array | Uint32Array, usage: number): GPUBuffer {
    const size = Math.max(MIN_BUFFER_BYTES, align4(data.byteLength));
    const buffer = this.device.createBuffer({ label: `gpu clod resident ${nodeId} ${label}`, size, usage });
    if (data.byteLength > 0) {
      this.device.queue.writeBuffer(buffer, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
    }
    return buffer;
  }

  private evictToBudget(protectedIds: ReadonlySet<string>): void {
    const budget = this.budgetBytes();
    while (this.residentBytes > budget && this.entries.size > 0) {
      let oldestId: string | null = null;
      let oldestTouch = Infinity;
      for (const [id, entry] of this.entries) {
        if (protectedIds.has(id) || entry.lastTouch >= oldestTouch) continue;
        oldestId = id;
        oldestTouch = entry.lastTouch;
      }
      if (oldestId === null) return;
      const entry = this.entries.get(oldestId)!;
      this.entries.delete(oldestId);
      retireGpuClodResidentPage(oldestId, entry.page);
      this.residentBytes -= entry.page.byteLength;
      this.evictionsTotal++;
    }
  }

  private budgetBytes(): number {
    return Math.max(MIN_BUFFER_BYTES, this.config.maxResidentBytes);
  }

  private publishCounters(): void {
    const counters = (globalThis as typeof globalThis & {
      window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
    }).window?.__drusnielClod?.stats?.counters;
    if (!counters) return;
    const stats = this.stats();
    counters["live_clod_gpu_hierarchy_enabled"] = stats.enabled;
    counters["live_clod_gpu_resident_pages"] = stats.residentPages;
    counters["live_clod_gpu_resident_bytes"] = stats.residentBytes;
    counters["live_clod_gpu_resident_uploads_total"] = stats.uploadsTotal;
    counters["live_clod_gpu_resident_upload_bytes_total"] = stats.uploadBytesTotal;
    counters["live_clod_gpu_resident_adopted_total"] = stats.adoptedPagesTotal;
    counters["live_clod_gpu_resident_evictions_total"] = stats.evictionsTotal;
    counters["live_clod_gpu_meshlets_resident"] = stats.meshletsResident;
    counters["live_clod_gpu_hierarchy_nodes_resident"] = stats.hierarchyNodesResident;
  }
}

function normalizedRevision(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value as number)) : 0;
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

export const GPU_CLOD_CPU_UPLOAD_BYTES_PER_VERTEX = GPU_CLOD_VERTEX_FLOATS * F32;
export const GPU_CLOD_INDEX_BYTES = U32;
