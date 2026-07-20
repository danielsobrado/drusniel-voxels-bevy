import { TREE_LODS, TREE_SPECIES } from "./tree_config.js";
import type { TreeGpuRingDrawResources } from "./tree_system_types.js";

export function applyTreeGpuRingDebugColorMaterials(
  resources: TreeGpuRingDrawResources | null,
  enabled: boolean,
): void {
  if (!resources) return;

  const meshesByName = new Map(resources.meshes.map((mesh) => [mesh.name, mesh]));
  for (const species of TREE_SPECIES) {
    for (const lod of TREE_LODS) {
      const mesh = meshesByName.get(`trees-ring-gpu-${species}-${lod}`);
      const handle = resources.materialHandles[`${species}:${lod}`];
      if (!mesh || !handle) continue;
      mesh.material = enabled ? handle.debugMaterials[lod] : handle.regularMaterial;
    }
  }
}
