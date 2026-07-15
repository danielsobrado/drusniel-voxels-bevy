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

export function validateDressingGpuCapacities(capacities: DressingGpuCapacities): void {
  for (const [name, value] of Object.entries(capacities)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`dressing GPU ${name} capacity must be positive`);
  }
  if (capacities.visibleInstances < capacities.drawGroups) {
    throw new Error("dressing GPU visible capacity cannot be smaller than draw-group capacity");
  }
}
