import classRulesSource from "./class_rules.wgsl?raw";
import terrainCandidatesSource from "./terrain_candidates.compute.wgsl?raw";
import attachmentCandidatesSource from "./attachment_candidates.compute.wgsl?raw";
import classifyLodSource from "./classify_lod.compute.wgsl?raw";
import type { DressingGpuResources } from "./resources.js";

const WORKGROUP_SIZE = 64;

export class DressingGpuDispatch {
  private readonly terrainPipeline: GPUComputePipeline;
  private readonly attachmentPipeline: GPUComputePipeline;
  private readonly classifyPipeline: GPUComputePipeline;

  constructor(private readonly device: GPUDevice) {
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
    resources.reset();
    this.run(encoder, this.terrainPipeline, resources, environmentCount);
    this.run(encoder, this.attachmentPipeline, resources, parentCount);
    this.run(encoder, this.classifyPipeline, resources, Math.min(resources.capacities.visibleInstances, environmentCount + parentCount));
  }

  private createPipeline(label: string, source: string): GPUComputePipeline {
    const module = this.device.createShaderModule({ label, code: `${classRulesSource}\n${source}` });
    return this.device.createComputePipeline({ label, layout: "auto", compute: { module, entryPoint: "main" } });
  }

  private run(
    encoder: GPUCommandEncoder,
    pipeline: GPUComputePipeline,
    resources: DressingGpuResources,
    count: number,
  ): void {
    if (count <= 0) return;
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
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
