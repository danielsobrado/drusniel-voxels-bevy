import type { ClodPageNode } from "../types.js";
import {
  CLOD_NODE_RECORD_BYTES,
  CLOD_NODE_RECORD_FLOATS,
  packClodNodeInto,
  packClodNodes,
} from "./clod_node_packing.js";
import type { ClodErrorComputeParams, ReadbackSlot } from "./clod_error_px_compute_types.js";
import { WORKGROUP_SIZE, writeFloat32Buffer } from "./clod_error_px_compute_types.js";

export function createClodNodeBuffer(device: GPUDevice, size: number, data: Float32Array): GPUBuffer {
  const buffer = device.createBuffer({
    label: "clod error px nodes",
    size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  writeFloat32Buffer(device, buffer, 0, data);
  return buffer;
}

export function createClodOutputBuffer(device: GPUDevice, size: number): GPUBuffer {
  return device.createBuffer({
    label: "clod error px output",
    size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
}

export function createClodParamBuffer(device: GPUDevice, size: number): GPUBuffer {
  return device.createBuffer({
    label: "clod error px params",
    size,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
}

export function createClodReadbackSlots(device: GPUDevice, slotCount: number, outputBytes: number): ReadbackSlot[] {
  return Array.from({ length: slotCount }, (_, index) => ({
    buffer: device.createBuffer({
      label: `clod error px readback ${index}`,
      size: outputBytes,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    }),
    busy: false,
    cpu: new Float32Array(Math.max(1, outputBytes / Float32Array.BYTES_PER_ELEMENT)),
  }));
}

export function createClodBindGroup(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  nodeBuffer: GPUBuffer,
  paramBuffer: GPUBuffer,
  outputBuffer: GPUBuffer,
): GPUBindGroup {
  return device.createBindGroup({
    label: "clod error px bind group",
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: nodeBuffer } },
      { binding: 1, resource: { buffer: paramBuffer } },
      { binding: 2, resource: { buffer: outputBuffer } },
    ],
  });
}

export function computeBufferSizes(nodeCount: number, packedByteLength: number): { nodeBytes: number; outputBytes: number } {
  return {
    nodeBytes: Math.max(CLOD_NODE_RECORD_BYTES, packedByteLength),
    outputBytes: Math.max(Float32Array.BYTES_PER_ELEMENT, nodeCount * Float32Array.BYTES_PER_ELEMENT),
  };
}

export function packNodes(nodes: readonly ClodPageNode[]): { data: Float32Array; nodeIndexById: Map<string, number>; nodeCount: number } {
  const packed = packClodNodes(nodes);
  return { data: packed.data, nodeIndexById: packed.nodeIndexById, nodeCount: nodes.length };
}

export interface NodePatch {
  index: number;
  node: ClodPageNode;
}

export function buildNodePatches(
  nodes: readonly ClodPageNode[],
  nodeIndexById: Map<string, number>,
): NodePatch[] {
  if (nodes.length === 0) return [];
  const updates: NodePatch[] = [];
  for (const node of nodes) {
    const index = nodeIndexById.get(node.id);
    if (index !== undefined) updates.push({ index, node });
  }
  return updates;
}

export function writeNodePatchesContiguous(
  device: GPUDevice,
  nodeBuffer: GPUBuffer,
  updates: NodePatch[],
): void {
  if (updates.length === 0) return;
  updates.sort((a, b) => a.index - b.index);
  const scratch = new Float32Array(updates.length * CLOD_NODE_RECORD_FLOATS);
  for (let i = 0; i < updates.length; i++) packClodNodeInto(scratch, i, updates[i].node);
  let runStart = 0;
  while (runStart < updates.length) {
    let runEnd = runStart;
    while (runEnd + 1 < updates.length && updates[runEnd + 1].index === updates[runEnd].index + 1) {
      runEnd++;
    }
    const floatStart = runStart * CLOD_NODE_RECORD_FLOATS;
    const floatEnd = (runEnd + 1) * CLOD_NODE_RECORD_FLOATS;
    writeFloat32Buffer(
      device, nodeBuffer,
      updates[runStart].index * CLOD_NODE_RECORD_BYTES,
      scratch.subarray(floatStart, floatEnd),
    );
    runStart = runEnd + 1;
  }
}

export function fillClodParams(
  paramScratch: Float32Array,
  params: ClodErrorComputeParams,
  nodeCount: number,
): void {
  paramScratch[0] = params.camPos[0];
  paramScratch[1] = params.camPos[1];
  paramScratch[2] = params.camPos[2];
  paramScratch[3] = params.viewportH;
  paramScratch[4] = params.fovY;
  paramScratch[5] = nodeCount;
  paramScratch[6] = 0;
  paramScratch[7] = 0;
}

export function createClodDispatchEncoder(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  bindGroup: GPUBindGroup,
  nodeCount: number,
): GPUCommandEncoder {
  const encoder = device.createCommandEncoder({ label: "clod error px encoder" });
  const pass = encoder.beginComputePass({ label: "clod error px pass" });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(nodeCount / WORKGROUP_SIZE));
  pass.end();
  return encoder;
}

export function findClodReadbackSlot(readbacks: ReadbackSlot[]): ReadbackSlot | undefined {
  return readbacks.find((candidate) => !candidate.busy);
}

export function destroyReadbackSlots(readbacks: ReadbackSlot[]): void {
  for (const slot of readbacks) {
    if (!slot.busy) slot.buffer.destroy();
  }
}
