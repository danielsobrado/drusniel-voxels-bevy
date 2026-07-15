export const DRESSING_ENVIRONMENT_FLOATS = 32;
export const DRESSING_ENVIRONMENT_STRIDE_BYTES = DRESSING_ENVIRONMENT_FLOATS * 4;
export const DRESSING_INSTANCE_WORDS = 16;
export const DRESSING_INSTANCE_STRIDE_BYTES = DRESSING_INSTANCE_WORDS * 4;
export const DRESSING_INDIRECT_WORDS = 5;
export const DRESSING_INDIRECT_STRIDE_BYTES = DRESSING_INDIRECT_WORDS * 4;

export interface DressingGpuCapacities {
  readonly environments: number;
  readonly terrainCandidates: number;
  readonly attachmentCandidates: number;
  readonly visibleInstances: number;
  readonly drawGroups: number;
}

export interface DressingIndirectDrawTemplate {
  readonly indexCount: number;
  readonly firstIndex: number;
  readonly baseVertex: number;
  readonly firstInstance: number;
}

export function validateDressingGpuCapacities(capacities: DressingGpuCapacities): void {
  for (const [name, value] of Object.entries(capacities)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`dressing GPU ${name} capacity must be positive`);
  }
  if (capacities.visibleInstances < capacities.drawGroups) {
    throw new Error("dressing GPU visible capacity cannot be smaller than draw-group capacity");
  }
}

export function createDressingCounterReset(environmentCount: number, parentCount: number): Uint32Array<ArrayBuffer> {
  const counters = new Uint32Array(new ArrayBuffer(64 * Uint32Array.BYTES_PER_ELEMENT));
  counters[4] = environmentCount >>> 0;
  counters[5] = parentCount >>> 0;
  return counters;
}

export function createDressingIndirectReset(
  drawGroups: number,
  templates: readonly DressingIndirectDrawTemplate[] = [],
): Uint32Array<ArrayBuffer> {
  if (!Number.isSafeInteger(drawGroups) || drawGroups < 1) throw new Error("dressing GPU draw-group capacity must be positive");
  if (templates.length > drawGroups) throw new Error("dressing GPU indirect templates exceed draw-group capacity");
  const words = new Uint32Array(new ArrayBuffer(drawGroups * DRESSING_INDIRECT_STRIDE_BYTES));
  for (let group = 0; group < templates.length; group++) {
    const template = templates[group];
    validateUint32("indexCount", template.indexCount);
    validateUint32("firstIndex", template.firstIndex);
    validateInt32("baseVertex", template.baseVertex);
    validateUint32("firstInstance", template.firstInstance);
    const offset = group * DRESSING_INDIRECT_WORDS;
    words[offset] = template.indexCount;
    words[offset + 1] = 0;
    words[offset + 2] = template.firstIndex;
    words[offset + 3] = template.baseVertex >>> 0;
    words[offset + 4] = template.firstInstance;
  }
  return words;
}

function validateUint32(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`dressing GPU indirect ${name} must be a uint32`);
  }
}

function validateInt32(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < -0x8000_0000 || value > 0x7fff_ffff) {
    throw new Error(`dressing GPU indirect ${name} must be an int32`);
  }
}
