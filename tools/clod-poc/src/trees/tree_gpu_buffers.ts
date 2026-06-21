import type { TreeSettings } from "./tree_config.js";
import {
  TREE_GPU_CANDIDATE_BYTES,
  TREE_GPU_CULL_PARAM_BYTES,
  TREE_GPU_VISIBLE_BYTES,
} from "./tree_gpu_types.js";

export interface TreeGpuBufferSizes {
  candidateCapacity: number;
  visibleCapacity: number;
  candidateBytes: number;
  visibleBytes: number;
  readbackVisibleBytes: number;
}

export interface TreeGpuBuffers {
  candidateCapacity: number;
  visibleCapacity: number;
  candidateBuffer: GPUBuffer;
  visibleBuffer: GPUBuffer;
  visibleCountBuffer: GPUBuffer;
  paramsBuffer: GPUBuffer;
  readbackVisibleBuffer: GPUBuffer | null;
  readbackCountBuffer: GPUBuffer | null;
  dispose(): void;
}

export function treeGpuBufferSizes(
  settings: TreeSettings,
  candidateCapacity: number,
  visibleCapacity: number,
): TreeGpuBufferSizes {
  const candidates = Math.max(0, Math.min(settings.gpu.maxCandidates, Math.floor(candidateCapacity)));
  const visible = Math.max(0, Math.min(settings.gpu.maxVisible, Math.floor(visibleCapacity)));
  const readbackVisible = Math.min(visible, settings.gpu.debugReadbackLimit > 0
    ? Math.max(settings.gpu.debugReadbackLimit, visible)
    : visible);
  return {
    candidateCapacity: candidates,
    visibleCapacity: visible,
    candidateBytes: Math.max(TREE_GPU_CANDIDATE_BYTES, candidates * TREE_GPU_CANDIDATE_BYTES),
    visibleBytes: Math.max(TREE_GPU_VISIBLE_BYTES, visible * TREE_GPU_VISIBLE_BYTES),
    readbackVisibleBytes: Math.max(TREE_GPU_VISIBLE_BYTES, readbackVisible * TREE_GPU_VISIBLE_BYTES),
  };
}

export function createTreeGpuBuffers(
  device: GPUDevice,
  settings: TreeSettings,
  candidateCapacity: number,
  visibleCapacity: number,
): TreeGpuBuffers {
  const sizes = treeGpuBufferSizes(settings, candidateCapacity, visibleCapacity);
  const candidateBuffer = device.createBuffer({
    label: "tree gpu candidates",
    size: sizes.candidateBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const visibleBuffer = device.createBuffer({
    label: "tree gpu visible records",
    size: sizes.visibleBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const visibleCountBuffer = device.createBuffer({
    label: "tree gpu visible count",
    size: Uint32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  const paramsBuffer = device.createBuffer({
    label: "tree gpu cull params",
    size: TREE_GPU_CULL_PARAM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const readbackVisibleBuffer = settings.gpu.readbackVisibleLists
    ? device.createBuffer({
        label: "tree gpu visible readback",
        size: sizes.readbackVisibleBytes,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      })
    : null;
  const readbackCountBuffer = settings.gpu.readbackVisibleLists
    ? device.createBuffer({
        label: "tree gpu count readback",
        size: Uint32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      })
    : null;

  return {
    candidateCapacity: sizes.candidateCapacity,
    visibleCapacity: sizes.visibleCapacity,
    candidateBuffer,
    visibleBuffer,
    visibleCountBuffer,
    paramsBuffer,
    readbackVisibleBuffer,
    readbackCountBuffer,
    dispose() {
      candidateBuffer.destroy();
      visibleBuffer.destroy();
      visibleCountBuffer.destroy();
      paramsBuffer.destroy();
      readbackVisibleBuffer?.destroy();
      readbackCountBuffer?.destroy();
    },
  };
}

export function ensureTreeGpuBuffers(
  device: GPUDevice,
  current: TreeGpuBuffers | null,
  settings: TreeSettings,
  candidateCapacity: number,
  visibleCapacity: number,
): TreeGpuBuffers {
  const sizes = treeGpuBufferSizes(settings, candidateCapacity, visibleCapacity);
  const readbackChanged = settings.gpu.readbackVisibleLists !== !!current?.readbackVisibleBuffer;
  if (
    current &&
    current.candidateCapacity >= sizes.candidateCapacity &&
    current.visibleCapacity >= sizes.visibleCapacity &&
    !readbackChanged
  ) {
    return current;
  }
  current?.dispose();
  return createTreeGpuBuffers(device, settings, sizes.candidateCapacity, sizes.visibleCapacity);
}
