import classRulesSource from "./class_rules.wgsl?raw";
import terrainCandidatesSource from "./terrain_candidates.compute.wgsl?raw";
import attachmentCandidatesSource from "./attachment_candidates.compute.wgsl?raw";
import classifyLodSource from "./classify_lod.compute.wgsl?raw";
import type { DressingGpuResources } from "./resources.js";
import {
  type DressingGpuCapacities,
} from "./layouts.js";

export { createDressingCounterReset, createDressingIndirectReset } from "./layouts.js";

const WORKGROUP_SIZE = 64;

export class DressingGpuDispatch {
  private readonly terrainPipeline: GPUComputePipeline;
  private readonly attachmentPipeline: GPUComputePipeline;
  private readonly classifyPipeline: GPUComputePipeline;
  private readonly bindGroupLayout: GPUBindGroupLayout;
  private readonly pipelineLayout: GPUPipelineLayout;

  constructor(private readonly device: GPUDevice) {
    this.bindGroupLayout = device.createBindGroupLayout({
      label: "dressing bind group layout",
      entries: [
        { binding: 0, visibility: 4, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: 4, buffer: { type: "storage" } },
        { binding: 2, visibility: 4, buffer: { type: "storage" } },
        { binding: 3, visibility: 4, buffer: { type: "storage" } },
        { binding: 4, visibility: 4, buffer: { type: "storage" } },
        { binding: 5, visibility: 4, buffer: { type: "storage" } },
      ],
    });
    this.pipelineLayout = device.createPipelineLayout({
      label: "dressing pipeline layout",
      bindGroupLayouts: [this.bindGroupLayout],
    });
    this.terrainPipeline = this.createPipeline("dressing terrain candidates", terrainCandidatesSource);
    this.attachmentPipeline = this.createPipeline("dressing attachment candidates", attachmentCandidatesSource);
    this.classifyPipeline = this.createPipeline("dressing classify LOD", classifyLodSource);
  }

  dispatch(
    encoder: GPUCommandEncoder,
    resources: DressingGpuResources,
    environmentCount: number,
    parentCount: number,
  ): void {
    validateDressingGpuDispatchCounts(resources.capacities, environmentCount, parentCount);
    resources.reset(environmentCount, parentCount);
    this.run(encoder, this.terrainPipeline, resources, environmentCount);
    this.run(encoder, this.attachmentPipeline, resources, parentCount);
    this.run(encoder, this.classifyPipeline, resources, Math.min(resources.capacities.visibleInstances, environmentCount + parentCount));
  }

  private createPipeline(label: string, source: string): GPUComputePipeline {
    const module = this.device.createShaderModule({ label, code: `${classRulesSource}\n${source}` });
    return this.device.createComputePipeline({ label, layout: this.pipelineLayout, compute: { module, entryPoint: "main" } });
  }

  private run(
    encoder: GPUCommandEncoder,
    pipeline: GPUComputePipeline,
    resources: DressingGpuResources,
    count: number,
  ): void {
    if (count <= 0) return;
    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: resources.environmentBuffer } },
        { binding: 1, resource: { buffer: resources.terrainCandidateBuffer } },
        { binding: 2, resource: { buffer: resources.attachmentCandidateBuffer } },
        { binding: 3, resource: { buffer: resources.visibleInstanceBuffer } },
        { binding: 4, resource: { buffer: resources.indirectBuffer } },
        { binding: 5, resource: { buffer: resources.countersBuffer } },
      ],
    });
    const pass = encoder.beginComputePass({ label: pipeline.label });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(count / WORKGROUP_SIZE));
    pass.end();
  }
}

export function validateDressingGpuDispatchCounts(
  capacities: DressingGpuCapacities,
  environmentCount: number,
  parentCount: number,
): void {
  if (!Number.isSafeInteger(environmentCount) || !Number.isSafeInteger(parentCount) || environmentCount < 0 || parentCount < 0) {
    throw new Error("dressing GPU dispatch counts must be non-negative integers");
  }
  if (environmentCount > capacities.environments || environmentCount > capacities.terrainCandidates) {
    throw new Error(`dressing GPU environment dispatch exceeds capacity: ${environmentCount}`);
  }
  if (parentCount > capacities.terrainCandidates || parentCount > capacities.attachmentCandidates) {
    throw new Error(`dressing GPU parent dispatch exceeds capacity: ${parentCount}`);
  }
  if (environmentCount + parentCount > capacities.visibleInstances) {
    throw new Error(`dressing GPU visible dispatch exceeds capacity: ${environmentCount + parentCount}`);
  }
}
