export type TreeGpuCpuPatchAction = "keep" | "retire";

export interface TreeGpuCpuPatchHandoffInput {
  gpuUpdated: boolean;
  gpuReady: boolean;
  fallbackToCpu: boolean;
}

export function treeGpuCpuPatchHandoffAction(
  input: TreeGpuCpuPatchHandoffInput,
): TreeGpuCpuPatchAction {
  if (input.gpuUpdated) return input.gpuReady ? "retire" : "keep";
  return input.fallbackToCpu ? "keep" : "retire";
}
