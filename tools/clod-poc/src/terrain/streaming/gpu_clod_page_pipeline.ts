import type { ClodPageNode, PageFootprint, PageMesh } from "../../types.js";
import type { GpuClodHierarchyConfig } from "./gpu_clod_hierarchy_config.js";
import {
  GPU_CLOD_INDEX_OFFSET_WGSL,
  GPU_CLOD_MESHLET_HIERARCHY_WGSL,
  GPU_CLOD_MESHLET_WGSL,
  GPU_CLOD_PACK_WGSL,
  GPU_CLOD_PAGE_WORKGROUP_SIZE,
  GPU_CLOD_SIMPLIFY_RUNTIME_WGSL,
  GPU_CLOD_WELD_RUNTIME_WGSL,
} from "./gpu_clod_page_compute_shaders.js";
import {
  GPU_CLOD_VERTEX_STRIDE_BYTES,
  destroyGpuClodResidentPage,
  type GpuClodMeshletBuffers,
  type GpuClodResidentPage,
} from "./gpu_clod_resident_types.js";

const U32 = Uint32Array.BYTES_PER_ELEMENT;
const F32 = Float32Array.BYTES_PER_ELEMENT;
const MIN_BUFFER_BYTES = 4;
const INVALID_INDEX = 0xffff_ffff;
const MESHLET_FANOUT = 4;
const VERTEX_USAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | GPUBufferUsage.VERTEX;
const INDEX_USAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | GPUBufferUsage.INDEX;
const STORAGE_USAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;

export interface GpuClodChunkSource {
  positionBaseF32: number;
  normalBaseF32: number;
  materialBaseF32: number;
  indexBaseU32: number;
  vertexCount: number;
  indexCount: number;
}

export interface GpuClodSourceBuffers {
  positions: GPUBuffer;
  normals: GPUBuffer;
  materials: GPUBuffer;
  indices: GPUBuffer;
}

export interface GpuClodPageIdentity {
  id: string;
  revision: number;
  level: number;
  footprint: PageFootprint;
}

export interface GpuClodPagePipelineOptions {
  fieldParams: GPUBuffer;
  config: GpuClodHierarchyConfig;
  weldEpsilon: number;
  normalDotMin: number;
  materialEpsilon: number;
  terrainMinY: number;
  terrainMaxY: number;
}

interface MeshBuffers {
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  vertexCount: number;
  indexCount: number;
  errorWorld: number;
  lowBenefit: boolean;
}

interface CounterResult {
  vertexCount: number;
  indexCount: number;
  probeFailures: number;
  maxError: number;
}

export class GpuClodPagePipeline {
  private constructor(
    private readonly device: GPUDevice,
    private readonly options: GpuClodPagePipelineOptions,
    private readonly packVerticesPipeline: GPUComputePipeline,
    private readonly packIndicesPipeline: GPUComputePipeline,
    private readonly weldVerticesPipeline: GPUComputePipeline,
    private readonly weldIndicesPipeline: GPUComputePipeline,
    private readonly simplifyVerticesPipeline: GPUComputePipeline,
    private readonly simplifyIndicesPipeline: GPUComputePipeline,
    private readonly indexOffsetPipeline: GPUComputePipeline,
    private readonly meshletPipeline: GPUComputePipeline,
    private readonly hierarchyPipeline: GPUComputePipeline,
  ) {}

  static async create(device: GPUDevice, options: GpuClodPagePipelineOptions): Promise<GpuClodPagePipeline> {
    const packModule = device.createShaderModule({ label: "gpu clod page pack", code: GPU_CLOD_PACK_WGSL });
    const weldModule = device.createShaderModule({ label: "gpu clod page weld", code: GPU_CLOD_WELD_RUNTIME_WGSL });
    const simplifyModule = device.createShaderModule({ label: "gpu clod page simplify", code: GPU_CLOD_SIMPLIFY_RUNTIME_WGSL });
    const indexModule = device.createShaderModule({ label: "gpu clod parent index offset", code: GPU_CLOD_INDEX_OFFSET_WGSL });
    const meshletModule = device.createShaderModule({ label: "gpu clod meshlets", code: GPU_CLOD_MESHLET_WGSL });
    const hierarchyModule = device.createShaderModule({ label: "gpu clod meshlet hierarchy", code: GPU_CLOD_MESHLET_HIERARCHY_WGSL });
    const pipeline = (label: string, module: GPUShaderModule, entryPoint: string) => device.createComputePipelineAsync({
      label,
      layout: "auto",
      compute: { module, entryPoint },
    });
    const [
      packVerticesPipeline,
      packIndicesPipeline,
      weldVerticesPipeline,
      weldIndicesPipeline,
      simplifyVerticesPipeline,
      simplifyIndicesPipeline,
      indexOffsetPipeline,
      meshletPipeline,
      hierarchyPipeline,
    ] = await Promise.all([
      pipeline("gpu clod pack vertices", packModule, "packVertices"),
      pipeline("gpu clod pack indices", packModule, "packIndices"),
      pipeline("gpu clod weld vertices", weldModule, "weldVertices"),
      pipeline("gpu clod weld indices", weldModule, "weldIndices"),
      pipeline("gpu clod simplify vertices", simplifyModule, "simplifyVertices"),
      pipeline("gpu clod simplify indices", simplifyModule, "simplifyIndices"),
      pipeline("gpu clod offset indices", indexModule, "offsetIndices"),
      pipeline("gpu clod build meshlets", meshletModule, "buildMeshlets"),
      pipeline("gpu clod build meshlet hierarchy", hierarchyModule, "buildHierarchy"),
    ]);
    return new GpuClodPagePipeline(
      device,
      options,
      packVerticesPipeline,
      packIndicesPipeline,
      weldVerticesPipeline,
      weldIndicesPipeline,
      simplifyVerticesPipeline,
      simplifyIndicesPipeline,
      indexOffsetPipeline,
      meshletPipeline,
      hierarchyPipeline,
    );
  }

  async buildLod0Page(
    identity: GpuClodPageIdentity,
    sourceBuffers: GpuClodSourceBuffers,
    chunks: readonly GpuClodChunkSource[],
  ): Promise<GpuClodResidentPage> {
    if (chunks.length === 0) return this.emptyPage(identity);
    const packed = this.packChunks(sourceBuffers, chunks);
    const welded = this.options.config.gpuWeld ? await this.weld(packed) : packed;
    if (welded !== packed) destroyMeshBuffers(packed);
    return this.finalize(identity, welded, conservativeBounds(identity.footprint, this.options.terrainMinY, this.options.terrainMaxY));
  }

  async buildParentPage(
    identity: GpuClodPageIdentity,
    children: readonly GpuClodResidentPage[],
  ): Promise<GpuClodResidentPage> {
    if (children.length !== 4) throw new Error(`${identity.id} requires exactly four GPU child pages`);
    const merged = this.mergeChildren(children);
    const welded = this.options.config.gpuWeld ? await this.weld(merged) : merged;
    if (welded !== merged) destroyMeshBuffers(merged);
    const simplified = this.options.config.gpuSimplify
      ? await this.simplify(welded, identity.footprint, identity.level)
      : welded;
    if (simplified !== welded) destroyMeshBuffers(welded);
    const bounds = unionBounds(children.map((child) => child.bounds));
    return this.finalize(identity, {
      ...simplified,
      errorWorld: simplified.errorWorld + Math.max(...children.map((child) => child.errorWorld)),
    }, bounds);
  }

  async attachMeshlets(page: GpuClodResidentPage): Promise<GpuClodResidentPage> {
    if (!this.options.config.meshlets || page.indexCount === 0 || page.meshlets) return page;
    const meshlets = this.buildMeshlets(page);
    return { ...page, meshlets, byteLength: page.byteLength + meshlets.byteLength };
  }

  async readbackPage(page: GpuClodResidentPage): Promise<PageMesh> {
    const vertexBytes = page.vertexCount * GPU_CLOD_VERTEX_STRIDE_BYTES;
    const indexBytes = page.indexCount * U32;
    const readback = this.device.createBuffer({
      label: `gpu clod selective readback ${page.id}`,
      size: Math.max(MIN_BUFFER_BYTES, vertexBytes + indexBytes),
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    let mapped = false;
    try {
      const encoder = this.device.createCommandEncoder({ label: `gpu clod selective readback ${page.id}` });
      if (vertexBytes > 0) encoder.copyBufferToBuffer(page.vertexBuffer, 0, readback, 0, vertexBytes);
      if (indexBytes > 0) encoder.copyBufferToBuffer(page.indexBuffer, 0, readback, vertexBytes, indexBytes);
      this.device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      mapped = true;
      const data = readback.getMappedRange();
      const packed = new Float32Array(data.slice(0, vertexBytes));
      const indices = new Uint32Array(data.slice(vertexBytes, vertexBytes + indexBytes));
      const positions = new Float32Array(page.vertexCount * 3);
      const normals = new Float32Array(page.vertexCount * 3);
      const paintSlots = new Float32Array(page.vertexCount);
      const materialWeights = new Float32Array(page.vertexCount * 4);
      for (let vertex = 0; vertex < page.vertexCount; vertex++) {
        const source = vertex * 16;
        const target3 = vertex * 3;
        const target4 = vertex * 4;
        positions[target3] = packed[source] ?? 0;
        positions[target3 + 1] = packed[source + 1] ?? 0;
        positions[target3 + 2] = packed[source + 2] ?? 0;
        normals[target3] = packed[source + 4] ?? 0;
        normals[target3 + 1] = packed[source + 5] ?? 1;
        normals[target3 + 2] = packed[source + 6] ?? 0;
        const slot = packed[source + 8] ?? -1;
        const paintWeight = packed[source + 12] ?? 0;
        paintSlots[vertex] = paintWeight > 0 && slot >= 0 ? slot + 1 : 0;
        materialWeights[target4] = paintWeight;
        materialWeights[target4 + 1] = packed[source + 13] ?? 0;
        materialWeights[target4 + 2] = packed[source + 14] ?? 0;
        materialWeights[target4 + 3] = packed[source + 15] ?? 0;
      }
      return { positions, normals, paintSlots, materialWeights, materialWeightStride: 4, indices };
    } finally {
      if (mapped) readback.unmap();
      readback.destroy();
    }
  }

  destroyPage(page: GpuClodResidentPage): void {
    destroyGpuClodResidentPage(page);
  }

  private packChunks(source: GpuClodSourceBuffers, chunks: readonly GpuClodChunkSource[]): MeshBuffers {
    let totalVertices = 0;
    let totalIndices = 0;
    const descriptors = new Uint32Array(chunks.length * 8);
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index]!;
      const base = index * 8;
      descriptors[base] = chunk.positionBaseF32;
      descriptors[base + 1] = chunk.normalBaseF32;
      descriptors[base + 2] = chunk.materialBaseF32;
      descriptors[base + 3] = chunk.indexBaseU32;
      descriptors[base + 4] = chunk.vertexCount;
      descriptors[base + 5] = chunk.indexCount;
      descriptors[base + 6] = totalVertices;
      descriptors[base + 7] = totalIndices;
      totalVertices += chunk.vertexCount;
      totalIndices += chunk.indexCount;
    }
    const vertexBuffer = this.buffer("gpu clod packed input vertices", totalVertices * GPU_CLOD_VERTEX_STRIDE_BYTES, VERTEX_USAGE);
    const indexBuffer = this.buffer("gpu clod packed input indices", totalIndices * U32, INDEX_USAGE);
    const descriptorBuffer = this.upload("gpu clod chunk descriptors", descriptors, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    const paramsBuffer = this.upload("gpu clod pack params", new Uint32Array([chunks.length, totalVertices, totalIndices, 0]), GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    const bindGroup = this.device.createBindGroup({
      label: "gpu clod pack bind group",
      layout: this.packVerticesPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: source.positions } },
        { binding: 1, resource: { buffer: source.normals } },
        { binding: 2, resource: { buffer: source.materials } },
        { binding: 3, resource: { buffer: source.indices } },
        { binding: 4, resource: { buffer: descriptorBuffer } },
        { binding: 5, resource: { buffer: this.options.fieldParams } },
        { binding: 6, resource: { buffer: paramsBuffer } },
        { binding: 7, resource: { buffer: vertexBuffer } },
        { binding: 8, resource: { buffer: indexBuffer } },
      ],
    });
    const encoder = this.device.createCommandEncoder({ label: "gpu clod pack page" });
    const vertexPass = encoder.beginComputePass();
    vertexPass.setPipeline(this.packVerticesPipeline);
    vertexPass.setBindGroup(0, bindGroup);
    vertexPass.dispatchWorkgroups(workgroups(totalVertices));
    vertexPass.end();
    const indexPass = encoder.beginComputePass();
    indexPass.setPipeline(this.packIndicesPipeline);
    indexPass.setBindGroup(0, bindGroup);
    indexPass.dispatchWorkgroups(workgroups(totalIndices));
    indexPass.end();
    this.device.queue.submit([encoder.finish()]);
    descriptorBuffer.destroy();
    paramsBuffer.destroy();
    return { vertexBuffer, indexBuffer, vertexCount: totalVertices, indexCount: totalIndices, errorWorld: 0, lowBenefit: false };
  }

  private mergeChildren(children: readonly GpuClodResidentPage[]): MeshBuffers {
    const totalVertices = children.reduce((sum, child) => sum + child.vertexCount, 0);
    const totalIndices = children.reduce((sum, child) => sum + child.indexCount, 0);
    const vertexBuffer = this.buffer("gpu clod parent merged vertices", totalVertices * GPU_CLOD_VERTEX_STRIDE_BYTES, VERTEX_USAGE);
    const indexBuffer = this.buffer("gpu clod parent merged indices", totalIndices * U32, INDEX_USAGE);
    const encoder = this.device.createCommandEncoder({ label: "gpu clod merge parent" });
    let vertexOffset = 0;
    let indexOffset = 0;
    const transientParams: GPUBuffer[] = [];
    for (const child of children) {
      const vertexBytes = child.vertexCount * GPU_CLOD_VERTEX_STRIDE_BYTES;
      if (vertexBytes > 0) encoder.copyBufferToBuffer(child.vertexBuffer, 0, vertexBuffer, vertexOffset * GPU_CLOD_VERTEX_STRIDE_BYTES, vertexBytes);
      if (child.indexCount > 0) {
        const params = this.upload(
          "gpu clod index offset params",
          new Uint32Array([child.indexCount, indexOffset, vertexOffset, 0]),
          GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        );
        transientParams.push(params);
        const bindGroup = this.device.createBindGroup({
          label: "gpu clod index offset bind group",
          layout: this.indexOffsetPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: params } },
            { binding: 1, resource: { buffer: child.indexBuffer } },
            { binding: 2, resource: { buffer: indexBuffer } },
          ],
        });
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.indexOffsetPipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(workgroups(child.indexCount));
        pass.end();
      }
      vertexOffset += child.vertexCount;
      indexOffset += child.indexCount;
    }
    this.device.queue.submit([encoder.finish()]);
    for (const params of transientParams) params.destroy();
    return { vertexBuffer, indexBuffer, vertexCount: totalVertices, indexCount: totalIndices, errorWorld: 0, lowBenefit: false };
  }

  private async weld(input: MeshBuffers): Promise<MeshBuffers> {
    if (input.vertexCount === 0 || input.indexCount === 0) return input;
    const hashCapacity = nextPowerOfTwo(Math.max(4, input.vertexCount * 2));
    const hashBuffer = this.buffer("gpu clod weld hash", hashCapacity * 2 * U32, STORAGE_USAGE);
    const remapBuffer = this.buffer("gpu clod weld remap", input.vertexCount * U32, STORAGE_USAGE);
    const outputVertices = this.buffer("gpu clod welded vertices", input.vertexCount * GPU_CLOD_VERTEX_STRIDE_BYTES, VERTEX_USAGE);
    const outputIndices = this.buffer("gpu clod welded indices", input.indexCount * U32, INDEX_USAGE);
    const counters = this.buffer("gpu clod weld counters", 4 * U32, STORAGE_USAGE);
    const params = this.weldParams(input, hashCapacity - 1);
    const bindGroup = this.device.createBindGroup({
      label: "gpu clod weld bind group",
      layout: this.weldVerticesPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: input.vertexBuffer } },
        { binding: 2, resource: { buffer: input.indexBuffer } },
        { binding: 3, resource: { buffer: hashBuffer } },
        { binding: 4, resource: { buffer: remapBuffer } },
        { binding: 5, resource: { buffer: outputVertices } },
        { binding: 6, resource: { buffer: outputIndices } },
        { binding: 7, resource: { buffer: counters } },
      ],
    });
    const counterResult = await this.runReduction(
      "gpu clod weld",
      hashBuffer,
      counters,
      4 * U32,
      [
        { pipeline: this.weldVerticesPipeline, bindGroup, workItems: input.vertexCount },
        { pipeline: this.weldIndicesPipeline, bindGroup, workItems: Math.ceil(input.indexCount / 3) },
      ],
    );
    params.destroy();
    hashBuffer.destroy();
    remapBuffer.destroy();
    counters.destroy();
    if (counterResult.probeFailures > 0) {
      outputVertices.destroy();
      outputIndices.destroy();
      throw new Error(`GPU CLOD weld exhausted hash probes for ${counterResult.probeFailures} vertices`);
    }
    return {
      vertexBuffer: outputVertices,
      indexBuffer: outputIndices,
      vertexCount: counterResult.vertexCount,
      indexCount: counterResult.indexCount,
      errorWorld: input.errorWorld,
      lowBenefit: counterResult.indexCount >= input.indexCount * 0.95,
    };
  }

  private async simplify(input: MeshBuffers, footprint: PageFootprint, level: number): Promise<MeshBuffers> {
    if (input.vertexCount === 0 || input.indexCount === 0) return input;
    const hashCapacity = nextPowerOfTwo(Math.max(4, input.vertexCount * 2));
    const hashBuffer = this.buffer("gpu clod simplify hash", hashCapacity * 2 * U32, STORAGE_USAGE);
    const remapBuffer = this.buffer("gpu clod simplify remap", input.vertexCount * U32, STORAGE_USAGE);
    const outputVertices = this.buffer("gpu clod simplified vertices", input.vertexCount * GPU_CLOD_VERTEX_STRIDE_BYTES, VERTEX_USAGE);
    const outputIndices = this.buffer("gpu clod simplified indices", input.indexCount * U32, INDEX_USAGE);
    const counters = this.buffer("gpu clod simplify counters", 6 * U32, STORAGE_USAGE);
    const params = this.simplifyParams(input, footprint, level, hashCapacity - 1);
    const bindGroup = this.device.createBindGroup({
      label: "gpu clod simplify bind group",
      layout: this.simplifyVerticesPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: input.vertexBuffer } },
        { binding: 2, resource: { buffer: input.indexBuffer } },
        { binding: 3, resource: { buffer: hashBuffer } },
        { binding: 4, resource: { buffer: remapBuffer } },
        { binding: 5, resource: { buffer: outputVertices } },
        { binding: 6, resource: { buffer: outputIndices } },
        { binding: 7, resource: { buffer: counters } },
      ],
    });
    const result = await this.runReduction(
      "gpu clod simplify",
      hashBuffer,
      counters,
      6 * U32,
      [
        { pipeline: this.simplifyVerticesPipeline, bindGroup, workItems: input.vertexCount },
        { pipeline: this.simplifyIndicesPipeline, bindGroup, workItems: Math.ceil(input.indexCount / 3) },
      ],
    );
    params.destroy();
    hashBuffer.destroy();
    remapBuffer.destroy();
    counters.destroy();
    if (result.probeFailures > 0 || result.indexCount === 0) {
      outputVertices.destroy();
      outputIndices.destroy();
      throw new Error(`GPU CLOD simplifier failed: probes=${result.probeFailures}, indices=${result.indexCount}`);
    }
    return {
      vertexBuffer: outputVertices,
      indexBuffer: outputIndices,
      vertexCount: result.vertexCount,
      indexCount: result.indexCount,
      errorWorld: result.maxError,
      lowBenefit: result.indexCount >= input.indexCount * 0.95,
    };
  }

  private async runReduction(
    label: string,
    hashBuffer: GPUBuffer,
    counters: GPUBuffer,
    counterBytes: number,
    stages: readonly { pipeline: GPUComputePipeline; bindGroup: GPUBindGroup; workItems: number }[],
  ): Promise<CounterResult> {
    const readback = this.device.createBuffer({
      label: `${label} counter readback`,
      size: counterBytes,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    let mapped = false;
    try {
      const encoder = this.device.createCommandEncoder({ label });
      encoder.clearBuffer(hashBuffer);
      encoder.clearBuffer(counters);
      for (const stage of stages) {
        const pass = encoder.beginComputePass();
        pass.setPipeline(stage.pipeline);
        pass.setBindGroup(0, stage.bindGroup);
        pass.dispatchWorkgroups(workgroups(stage.workItems));
        pass.end();
      }
      encoder.copyBufferToBuffer(counters, 0, readback, 0, counterBytes);
      this.device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      mapped = true;
      const bytes = readback.getMappedRange().slice(0);
      const values = new Uint32Array(bytes);
      const view = new DataView(bytes);
      return {
        vertexCount: values[0] ?? 0,
        indexCount: values[1] ?? 0,
        probeFailures: counterBytes >= 6 * U32 ? values[4] ?? 0 : values[3] ?? 0,
        maxError: counterBytes >= 6 * U32 ? view.getFloat32(5 * U32, true) : 0,
      };
    } finally {
      if (mapped) readback.unmap();
      readback.destroy();
    }
  }

  private buildMeshlets(page: GpuClodResidentPage): GpuClodMeshletBuffers {
    const triangleLimit = Math.max(1, Math.min(
      this.options.config.meshletMaxTriangles,
      Math.floor(this.options.config.meshletMaxVertices / 3),
    ));
    const triangleCount = Math.ceil(page.indexCount / 3);
    const meshletCount = Math.max(1, Math.ceil(triangleCount / triangleLimit));
    const hierarchyLevels = hierarchyLevelPlan(meshletCount, MESHLET_FANOUT);
    const hierarchyNodeCount = hierarchyLevels.reduce((sum, level) => sum + level.count, 0);
    const headers = this.buffer("gpu clod meshlet headers", meshletCount * 8 * U32, STORAGE_USAGE);
    const bounds = this.buffer("gpu clod meshlet bounds", meshletCount * 4 * F32, STORAGE_USAGE);
    const indirect = this.buffer("gpu clod meshlet indirect", meshletCount * 5 * U32, STORAGE_USAGE | GPUBufferUsage.INDIRECT);
    const hierarchyHeaders = this.buffer("gpu clod hierarchy headers", hierarchyNodeCount * 4 * U32, STORAGE_USAGE);
    const hierarchyBounds = this.buffer("gpu clod hierarchy bounds", hierarchyNodeCount * 4 * F32, STORAGE_USAGE);
    const meshletParams = this.upload(
      "gpu clod meshlet params",
      new Uint32Array([page.indexCount, triangleLimit, meshletCount, 0]),
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    const meshletBindGroup = this.device.createBindGroup({
      label: "gpu clod meshlet bind group",
      layout: this.meshletPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: meshletParams } },
        { binding: 1, resource: { buffer: page.vertexBuffer } },
        { binding: 2, resource: { buffer: page.indexBuffer } },
        { binding: 3, resource: { buffer: headers } },
        { binding: 4, resource: { buffer: bounds } },
        { binding: 5, resource: { buffer: indirect } },
      ],
    });
    const encoder = this.device.createCommandEncoder({ label: `gpu clod meshlets ${page.id}` });
    const meshletPass = encoder.beginComputePass();
    meshletPass.setPipeline(this.meshletPipeline);
    meshletPass.setBindGroup(0, meshletBindGroup);
    meshletPass.dispatchWorkgroups(workgroups(meshletCount));
    meshletPass.end();
    const hierarchyParams: GPUBuffer[] = [];
    for (const level of hierarchyLevels) {
      const params = this.upload(
        "gpu clod hierarchy params",
        new Uint32Array([
          level.childStart,
          level.childCount,
          level.parentStart,
          level.count,
          MESHLET_FANOUT,
          level.level,
          level.childIsLeaf ? 1 : 0,
          0,
        ]),
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      );
      hierarchyParams.push(params);
      const bindGroup = this.device.createBindGroup({
        label: "gpu clod hierarchy bind group",
        layout: this.hierarchyPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: headers } },
          { binding: 1, resource: { buffer: bounds } },
          { binding: 2, resource: { buffer: hierarchyHeaders } },
          { binding: 3, resource: { buffer: hierarchyBounds } },
          { binding: 4, resource: { buffer: params } },
        ],
      });
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.hierarchyPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(workgroups(level.count));
      pass.end();
    }
    this.device.queue.submit([encoder.finish()]);
    meshletParams.destroy();
    for (const params of hierarchyParams) params.destroy();
    return {
      headers,
      bounds,
      hierarchyHeaders,
      hierarchyBounds,
      indirect,
      meshletCount,
      hierarchyNodeCount,
      byteLength: meshletCount * (8 * U32 + 4 * F32 + 5 * U32) + hierarchyNodeCount * (4 * U32 + 4 * F32),
    };
  }

  private finalize(identity: GpuClodPageIdentity, mesh: MeshBuffers, bounds: ClodPageNode["bounds"]): GpuClodResidentPage {
    return {
      id: identity.id,
      revision: identity.revision,
      level: identity.level,
      vertexBuffer: mesh.vertexBuffer,
      indexBuffer: mesh.indexBuffer,
      vertexCount: mesh.vertexCount,
      indexCount: mesh.indexCount,
      byteLength: mesh.vertexCount * GPU_CLOD_VERTEX_STRIDE_BYTES + mesh.indexCount * U32,
      bounds,
      errorWorld: mesh.errorWorld,
      lowBenefit: mesh.lowBenefit,
    };
  }

  private emptyPage(identity: GpuClodPageIdentity): GpuClodResidentPage {
    return this.finalize(identity, {
      vertexBuffer: this.buffer(`gpu clod empty vertices ${identity.id}`, MIN_BUFFER_BYTES, VERTEX_USAGE),
      indexBuffer: this.buffer(`gpu clod empty indices ${identity.id}`, MIN_BUFFER_BYTES, INDEX_USAGE),
      vertexCount: 0,
      indexCount: 0,
      errorWorld: 0,
      lowBenefit: true,
    }, conservativeBounds(identity.footprint, this.options.terrainMinY, this.options.terrainMaxY));
  }

  private weldParams(input: MeshBuffers, hashMask: number): GPUBuffer {
    const bytes = new ArrayBuffer(32);
    const view = new DataView(bytes);
    view.setUint32(0, input.vertexCount, true);
    view.setUint32(4, input.indexCount, true);
    view.setUint32(8, hashMask, true);
    view.setUint32(12, this.options.config.maxHashProbe, true);
    view.setFloat32(16, this.options.weldEpsilon, true);
    view.setFloat32(20, this.options.normalDotMin, true);
    view.setFloat32(24, this.options.materialEpsilon, true);
    return this.uploadBytes("gpu clod weld params", bytes, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  }

  private simplifyParams(input: MeshBuffers, footprint: PageFootprint, level: number, hashMask: number): GPUBuffer {
    const bytes = new ArrayBuffer(64);
    const view = new DataView(bytes);
    view.setUint32(0, input.vertexCount, true);
    view.setUint32(4, input.indexCount, true);
    view.setUint32(8, hashMask, true);
    view.setUint32(12, this.options.config.maxHashProbe, true);
    view.setFloat32(16, this.options.config.simplifyClusterSizeCells * 2 ** Math.max(0, level - 1), true);
    view.setFloat32(20, this.options.weldEpsilon, true);
    view.setFloat32(24, this.options.normalDotMin, true);
    view.setFloat32(28, this.options.materialEpsilon, true);
    view.setFloat32(32, footprint.minX, true);
    view.setFloat32(36, footprint.minZ, true);
    view.setFloat32(40, footprint.maxX, true);
    view.setFloat32(44, footprint.maxZ, true);
    return this.uploadBytes("gpu clod simplify params", bytes, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  }

  private buffer(label: string, size: number, usage: number): GPUBuffer {
    return this.device.createBuffer({ label, size: Math.max(MIN_BUFFER_BYTES, align4(size)), usage });
  }

  private upload(label: string, data: Uint32Array, usage: number): GPUBuffer {
    return this.uploadBytes(label, data.buffer as ArrayBuffer, usage, data.byteOffset, data.byteLength);
  }

  private uploadBytes(label: string, data: ArrayBuffer, usage: number, byteOffset = 0, byteLength = data.byteLength): GPUBuffer {
    const buffer = this.buffer(label, byteLength, usage);
    if (byteLength > 0) this.device.queue.writeBuffer(buffer, 0, data, byteOffset, byteLength);
    return buffer;
  }
}

export function conservativeBounds(
  footprint: PageFootprint,
  minY: number,
  maxY: number,
): ClodPageNode["bounds"] {
  const centerX = (footprint.minX + footprint.maxX) * 0.5;
  const centerZ = (footprint.minZ + footprint.maxZ) * 0.5;
  const centerY = (minY + maxY) * 0.5;
  const halfX = (footprint.maxX - footprint.minX) * 0.5;
  const halfZ = (footprint.maxZ - footprint.minZ) * 0.5;
  const halfY = (maxY - minY) * 0.5;
  return {
    center: [centerX, centerY, centerZ],
    radius: Math.hypot(halfX, halfY, halfZ),
    minY,
    maxY,
  };
}

function unionBounds(bounds: readonly ClodPageNode["bounds"][]): ClodPageNode["bounds"] {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const bound of bounds) {
    minX = Math.min(minX, bound.center[0] - bound.radius);
    minY = Math.min(minY, bound.minY);
    minZ = Math.min(minZ, bound.center[2] - bound.radius);
    maxX = Math.max(maxX, bound.center[0] + bound.radius);
    maxY = Math.max(maxY, bound.maxY);
    maxZ = Math.max(maxZ, bound.center[2] + bound.radius);
  }
  const center: [number, number, number] = [(minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5];
  return { center, radius: Math.hypot(maxX - center[0], maxY - center[1], maxZ - center[2]), minY, maxY };
}

function hierarchyLevelPlan(meshletCount: number, fanout: number): Array<{
  childStart: number;
  childCount: number;
  parentStart: number;
  count: number;
  level: number;
  childIsLeaf: boolean;
}> {
  const levels: Array<{
    childStart: number;
    childCount: number;
    parentStart: number;
    count: number;
    level: number;
    childIsLeaf: boolean;
  }> = [];
  let childStart = 0;
  let childCount = meshletCount;
  let parentStart = 0;
  let level = 1;
  let childIsLeaf = true;
  while (childCount > 1) {
    const count = Math.ceil(childCount / fanout);
    levels.push({ childStart, childCount, parentStart, count, level, childIsLeaf });
    childStart = parentStart;
    childCount = count;
    parentStart += count;
    childIsLeaf = false;
    level++;
  }
  return levels;
}

function destroyMeshBuffers(mesh: MeshBuffers): void {
  mesh.vertexBuffer.destroy();
  mesh.indexBuffer.destroy();
}

function workgroups(workItems: number): number {
  return Math.max(1, Math.ceil(Math.max(0, workItems) / GPU_CLOD_PAGE_WORKGROUP_SIZE));
}

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

export const GPU_CLOD_INVALID_INDEX = INVALID_INDEX;
