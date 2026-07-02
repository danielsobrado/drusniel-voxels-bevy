import type { WebGpuReadbackMode } from "../core/webgpu_readback_mode.js";

export interface ClodErrorComputeParams {
  camPos: [number, number, number];
  viewportH: number;
  fovY: number;
}

export interface ClodErrorMap {
  values: Float32Array;
  version: number;
  frameId: number;
  completedAt: number;
  params: ClodErrorComputeParams;
}

export interface ClodErrorPxStats {
  enabled: boolean;
  available: boolean;
  status: "unavailable" | "idle" | "running" | "ready" | "failed" | "disabled";
  reason?: string;
  nodeCount: number;
  version: number;
  latestAgeFrames: number | null;
  submitMs: number | null;
  readbackMs: number | null;
  skippedDispatches: number;
  parity: "unchecked" | "ok" | "failed" | "disabled";
  parityMaxDelta: number | null;
  readbackMode: WebGpuReadbackMode;
  dispatchOnlyFrames: number;
  readbackFrames: number;
}

export interface DispatchOptions {
  readback: boolean;
}

export interface ReadbackSlot {
  buffer: GPUBuffer;
  busy: boolean;
  cpu: Float32Array;
}

export const WORKGROUP_SIZE = 64;
export const PARAM_FLOATS = 8;
export const READBACK_SLOTS = 2;

export function cloneParams(params: ClodErrorComputeParams): ClodErrorComputeParams {
  return { camPos: [...params.camPos], viewportH: params.viewportH, fovY: params.fovY };
}

export function paramsFromSelection(
  camPos: [number, number, number],
  viewportH: number,
  fovY: number,
): ClodErrorComputeParams {
  return { camPos: [...camPos], viewportH, fovY };
}

export function writeFloat32Buffer(device: GPUDevice, buffer: GPUBuffer, offset: number, data: Float32Array): void {
  device.queue.writeBuffer(buffer, offset, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
}
