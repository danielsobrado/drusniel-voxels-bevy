import {
  DRESSING_ENVIRONMENT_STRIDE_BYTES,
  DRESSING_INDIRECT_STRIDE_BYTES,
  DRESSING_INSTANCE_STRIDE_BYTES,
  validateDressingGpuCapacities,
  type DressingGpuCapacities,
} from "./layouts.js";

export class DressingGpuResources {
  readonly environmentBuffer: GPUBuffer;
  readonly terrainCandidateBuffer: GPUBuffer;
  readonly attachmentCandidateBuffer: GPUBuffer;
  readonly visibleInstanceBuffer: GPUBuffer;
  readonly indirectBuffer: GPUBuffer;
  readonly countersBuffer: GPUBuffer;

  constructor(
    private readonly device: GPUDevice,
    readonly capacities: DressingGpuCapacities,
  ) {
    validateDressingGpuCapacities(capacities);
    this.environmentBuffer = this.createBuffer("dressing environments", capacities.environments * DRESSING_ENVIRONMENT_STRIDE_BYTES, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.terrainCandidateBuffer = this.createBuffer("dressing terrain candidates", capacities.terrainCandidates * DRESSING_INSTANCE_STRIDE_BYTES, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.attachmentCandidateBuffer = this.createBuffer("dressing attachment candidates", capacities.attachmentCandidates * DRESSING_INSTANCE_STRIDE_BYTES, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.visibleInstanceBuffer = this.createBuffer("dressing visible instances", capacities.visibleInstances * DRESSING_INSTANCE_STRIDE_BYTES, GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC);
    this.indirectBuffer = this.createBuffer("dressing indirect draws", capacities.drawGroups * DRESSING_INDIRECT_STRIDE_BYTES, GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST);
    this.countersBuffer = this.createBuffer("dressing counters", 256, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
  }

  reset(): void {
    this.device.queue.writeBuffer(this.countersBuffer, 0, new Uint32Array(64));
    this.device.queue.writeBuffer(this.indirectBuffer, 0, new Uint32Array(this.capacities.drawGroups * 5));
  }

  dispose(): void {
    this.environmentBuffer.destroy();
    this.terrainCandidateBuffer.destroy();
    this.attachmentCandidateBuffer.destroy();
    this.visibleInstanceBuffer.destroy();
    this.indirectBuffer.destroy();
    this.countersBuffer.destroy();
  }

  private createBuffer(label: string, size: number, usage: GPUBufferUsageFlags): GPUBuffer {
    return this.device.createBuffer({ label, size: Math.max(4, Math.ceil(size / 4) * 4), usage });
  }
}
