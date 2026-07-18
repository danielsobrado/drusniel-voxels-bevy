const RESIDENCY_CLUSTER_SIZE_M = 64;

export function treeResidencyClusterKeys(input: {
  readonly cpuPatchKeys: readonly string[];
  readonly centerX: number;
  readonly centerZ: number;
  readonly radiusM: number;
}): string[] {
  if (input.cpuPatchKeys.length > 0) {
    return [...new Set(input.cpuPatchKeys.map((key) => `tree-page:${key}`))].sort();
  }
  const radius = Math.max(RESIDENCY_CLUSTER_SIZE_M, input.radiusM);
  const minX = Math.floor((input.centerX - radius) / RESIDENCY_CLUSTER_SIZE_M);
  const maxX = Math.floor((input.centerX + radius) / RESIDENCY_CLUSTER_SIZE_M);
  const minZ = Math.floor((input.centerZ - radius) / RESIDENCY_CLUSTER_SIZE_M);
  const maxZ = Math.floor((input.centerZ + radius) / RESIDENCY_CLUSTER_SIZE_M);
  const keys: string[] = [];
  for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) {
      const centerX = (x + 0.5) * RESIDENCY_CLUSTER_SIZE_M;
      const centerZ = (z + 0.5) * RESIDENCY_CLUSTER_SIZE_M;
      if (Math.hypot(centerX - input.centerX, centerZ - input.centerZ) <= radius + RESIDENCY_CLUSTER_SIZE_M) {
        keys.push(`tree-ring:${x},${z}`);
      }
    }
  }
  return keys;
}
