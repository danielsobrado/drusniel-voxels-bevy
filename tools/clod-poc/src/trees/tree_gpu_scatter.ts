import type { TreeInstance } from "./tree_instances.js";
import {
  packTreeGpuCandidates,
  treeGpuSpeciesId,
  type TreeGpuCandidate,
} from "./tree_gpu_types.js";

export function treeInstancesToGpuCandidateRecords(
  instances: readonly TreeInstance[],
): TreeGpuCandidate[] {
  return instances.map((instance, index) => ({
    worldX: instance.position[0],
    worldY: instance.position[1],
    worldZ: instance.position[2],
    scale: instance.scale,
    rotationY: instance.rotationY,
    species: treeGpuSpeciesId(instance.species),
    seed: index,
    flags: 0,
  }));
}

export function treeInstancesToGpuCandidates(
  instances: readonly TreeInstance[],
): Float32Array {
  return packTreeGpuCandidates(treeInstancesToGpuCandidateRecords(instances));
}
