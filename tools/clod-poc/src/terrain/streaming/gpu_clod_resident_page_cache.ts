import type { ClodPageNode, PageMesh } from "../../types.js";
import type { GpuClodHierarchyConfig } from "./gpu_clod_hierarchy_config.js";
import {
  buildGpuClodMeshletHierarchy,
  type GpuClodMeshletHierarchy,
} from "./gpu_clod_meshlet_hierarchy.js";

const MIN_BUFFER_BYTES = 4;

type UploadArray = Float32Array | Uint32Array;

export interface GpuClodResidentPage {
  id: string;
  revision: number;
  level: number;
  vertexCount: number;
  indexCount: number;
  byteLength: number;
  positions: GPUBuffer;
  normals: GPUBuffer;
  paintSlots: GPUBuffer;
  materialWeights: GPUBuffer;
  indices: GPUBuffer;
  meshletHeaders?: GPUBuffer;
  meshletVertexIndices?: GPUBuffer;
  meshletTriangleIndices?: GPUBuffer;
  hierarchyHeaders?: GPUBuffer;
  hierarchyBounds?: GPUBuffer;
  meshletCount: number;
  hierarchyNodeCount: number;
}

export interface GpuClodResidentPageCacheStats {
  enabled: number;
  residentPages: number;
  residentBytes: number;
  uploadsTotal: number;
  uploadBytesTotal: number;
  evictionsTotal: number;
  meshletsResident: number;
  hierarchyNodesResident: number;
}

interface ResidentEntry {
  page: GpuClodResidentPage;
  sourceMesh: PageMesh;
  lastTouch: number;
}

export class GpuClodResidentPageCache {
  private readonly entries = new Map<string, ResidentEntry>();
  private residentBytes = 0;
  private uploadsTotal = 0;
  private uploadBytesTotal = 0;
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
      if (node.level > this.config.residentMaxLevel) continue;
      this.upsert(node);
    }
    this.evictToBudget();
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
    this.destroyPage(entry.page);
    this.residentBytes -= entry.page.byteLength;
    this.publishCounters();
  }

  stats(): GpuClodResidentPageCacheStats {
    let meshletsResident = 0;
    let hierarchyNodesResident = 0;
    for (const entry of this.entries.values()) {
      meshletsResident += entry.page.meshletCount;
      hierarchyNodesResident += entry.page.hierarchyNodeCount;
    }
    return {
      enabled: this.config.enabled ? 1 : 0,
      residentPages: this.entries.size,
      residentBytes: Math.max(0, this.residentBytes),
      uploadsTotal: this.uploadsTotal,
      uploadBytesTotal: this.uploadBytesTotal,
      evictionsTotal: this.evictionsTotal,
      meshletsResident,
      hierarchyNodesResident,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.values()) this.destroyPage(entry.page);
    this.entries.clear();
    this.residentBytes = 0;
    this.publishCounters();
  }

  private upsert(node: ClodPageNode): void {
    const revision = normalizedRevision(node.revision);
    const existing = this.entries.get(node.id);
    if (existing?.page.revision === revision && existing.sourceMesh === node.mesh) {
      existing.lastTouch = ++this.clock;
      return;
    }
    if (existing) {
      this.entries.delete(node.id);
      this.destroyPage(existing.page);
      this.residentBytes -= existing.page.byteLength;
    }

    const hierarchy = this.config.meshlets
      ? buildGpuClodMeshletHierarchy(node.mesh, {
        maxVertices: this.config.meshletMaxVertices,
        maxTriangles: this.config.meshletMaxTriangles,
      })
      : null;
    const page = this.uploadPage(node, revision, hierarchy);
    this.entries.set(node.id, { page, sourceMesh: node.mesh, lastTouch: ++this.clock });
    this.residentBytes += page.byteLength;
    this.uploadsTotal++;
    this.uploadBytesTotal += page.byteLength;
  }

  private uploadPage(
    node: ClodPageNode,
    revision: number,
    hierarchy: GpuClodMeshletHierarchy | null,
  ): GpuClodResidentPage {
    const mesh = node.mesh;
    const storageCopy = storageCopyUsage();
    const positions = this.upload("positions", node.id, mesh.positions, storageCopy | GPUBufferUsage.VERTEX);
    const normals = this.upload("normals", node.id, mesh.normals, storageCopy | GPUBufferUsage.VERTEX);
    const paintSlots = this.upload("paint slots", node.id, mesh.paintSlots, storageCopy | GPUBufferUsage.VERTEX);
    const materialWeights = this.upload("material weights", node.id, mesh.materialWeights, storageCopy | GPUBufferUsage.VERTEX);
    const indices = this.upload("indices", node.id, mesh.indices, storageCopy | GPUBufferUsage.INDEX);
    const optional = hierarchy ? {
      meshletHeaders: this.upload("meshlet headers", node.id, hierarchy.meshletHeaders, storageCopy),
      meshletVertexIndices: this.upload("meshlet vertices", node.id, hierarchy.vertexIndices, storageCopy),
      meshletTriangleIndices: this.upload("meshlet triangles", node.id, hierarchy.triangleIndices, storageCopy),
      hierarchyHeaders: this.upload("hierarchy headers", node.id, hierarchy.hierarchyHeaders, storageCopy),
      hierarchyBounds: this.upload("hierarchy bounds", node.id, hierarchy.bounds, storageCopy),
    } : {};
    return {
      id: node.id,
      revision,
      level: node.level,
      vertexCount: mesh.positions.length / 3,
      indexCount: mesh.indices.length,
      byteLength: meshBytes(mesh) + hierarchyBytes(hierarchy),
      positions,
      normals,
      paintSlots,
      materialWeights,
      indices,
      ...optional,
      meshletCount: hierarchy?.meshletCount ?? 0,
      hierarchyNodeCount: hierarchy?.hierarchyNodeCount ?? 0,
    };
  }

  private upload(label: string, nodeId: string, data: UploadArray, usage: number): GPUBuffer {
    const size = Math.max(MIN_BUFFER_BYTES, align4(data.byteLength));
    const buffer = this.device.createBuffer({ label: `gpu clod resident ${nodeId} ${label}`, size, usage });
    if (data.byteLength > 0) {
      this.device.queue.writeBuffer(
        buffer,
        0,
        data.buffer as ArrayBuffer,
        data.byteOffset,
        data.byteLength,
      );
    }
    return buffer;
  }

  private evictToBudget(): void {
    const budget = Math.max(MIN_BUFFER_BYTES, this.config.maxResidentBytes);
    while (this.residentBytes > budget && this.entries.size > 0) {
      let oldestId: string | null = null;
      let oldestTouch = Infinity;
      for (const [id, entry] of this.entries) {
        if (entry.lastTouch >= oldestTouch) continue;
        oldestId = id;
        oldestTouch = entry.lastTouch;
      }
      if (oldestId === null) return;
      const entry = this.entries.get(oldestId)!;
      this.entries.delete(oldestId);
      this.destroyPage(entry.page);
      this.residentBytes -= entry.page.byteLength;
      this.evictionsTotal++;
    }
  }

  private destroyPage(page: GpuClodResidentPage): void {
    page.positions.destroy();
    page.normals.destroy();
    page.paintSlots.destroy();
    page.materialWeights.destroy();
    page.indices.destroy();
    page.meshletHeaders?.destroy();
    page.meshletVertexIndices?.destroy();
    page.meshletTriangleIndices?.destroy();
    page.hierarchyHeaders?.destroy();
    page.hierarchyBounds?.destroy();
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
    counters["live_clod_gpu_resident_evictions_total"] = stats.evictionsTotal;
    counters["live_clod_gpu_meshlets_resident"] = stats.meshletsResident;
    counters["live_clod_gpu_hierarchy_nodes_resident"] = stats.hierarchyNodesResident;
  }
}

function storageCopyUsage(): number {
  return GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
}

function meshBytes(mesh: PageMesh): number {
  return mesh.positions.byteLength
    + mesh.normals.byteLength
    + mesh.paintSlots.byteLength
    + mesh.materialWeights.byteLength
    + mesh.indices.byteLength;
}

function hierarchyBytes(hierarchy: GpuClodMeshletHierarchy | null): number {
  if (!hierarchy) return 0;
  return hierarchy.meshletHeaders.byteLength
    + hierarchy.vertexIndices.byteLength
    + hierarchy.triangleIndices.byteLength
    + hierarchy.hierarchyHeaders.byteLength
    + hierarchy.bounds.byteLength;
}

function normalizedRevision(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value as number)) : 0;
}

function align4(value: number): number {
  return (value + 3) & ~3;
}
