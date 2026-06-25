import type { ClodErrorMap, ClodErrorPxCompute, DispatchOptions } from "../gpu/clod_error_px_compute.js";
import type { WebGpuReadbackMode } from "../core/webgpu_readback_mode.js";
import { errorPx, type SelectionParams } from "../clod/selection.js";
import type { ClodPageNode } from "../types.js";

export interface WebGpuParityTracker {
  lastParityFrame: number;
  parityVerified: boolean;
}

export function createWebGpuParityTracker(parityIntervalFrames: number): WebGpuParityTracker {
  return {
    lastParityFrame: -parityIntervalFrames,
    parityVerified: false,
  };
}

export function webGpuDispatchKey(params: SelectionParams): string {
  const q = (value: number, step = 0.25) => Math.round(value / step);
  const near = params.nearField;
  return [
    q(params.camPos[0]),
    q(params.camPos[1]),
    q(params.camPos[2]),
    q(params.viewportH, 1),
    q(params.fovY, 0.0005),
    q(params.thresholdPx, 0.01),
    params.enforce21 ? 1 : 0,
    params.forcedMaxLevel ?? -1,
    near?.enabled ? 1 : 0,
    q(near?.centerX ?? 0),
    q(near?.centerZ ?? 0),
    q(near?.radius ?? 0),
  ].join(":");
}

export function verifyWebGpuClodParity(options: {
  map: ClodErrorMap;
  params: SelectionParams;
  allNodes: readonly ClodPageNode[];
  compute: ClodErrorPxCompute;
  selectionFrameId: number;
  tracker: WebGpuParityTracker;
  parityIntervalFrames: number;
  errorTolerancePx: number;
  forceContinuous: boolean;
}): void {
  const {
    map,
    params,
    allNodes,
    compute,
    selectionFrameId,
    tracker,
    parityIntervalFrames,
    errorTolerancePx,
    forceContinuous,
  } = options;
  // Default: one-shot verification once the first GPU map is available. The full
  // per-node CPU sweep is a frame hitch, so only re-run it when explicitly enabled.
  if (tracker.parityVerified && !forceContinuous) return;
  if (selectionFrameId - tracker.lastParityFrame < parityIntervalFrames) return;
  tracker.lastParityFrame = selectionFrameId;
  tracker.parityVerified = true;
  const parityParams: SelectionParams = {
    ...params,
    camPos: [...map.params.camPos],
    viewportH: map.params.viewportH,
    fovY: map.params.fovY,
  };
  let maxDelta = 0;
  for (const node of allNodes) {
    const gpuValue = compute.valueFor(node, map);
    const cpuValue = errorPx(node, parityParams);
    if (gpuValue === undefined || !Number.isFinite(cpuValue)) {
      compute.markParityFailed("WebGPU CLOD error_px produced a non-finite result", Number.POSITIVE_INFINITY);
      return;
    }
    maxDelta = Math.max(maxDelta, Math.abs(gpuValue - cpuValue));
  }
  if (maxDelta > errorTolerancePx) {
    compute.markParityFailed(
      `WebGPU CLOD error_px parity exceeded ${errorTolerancePx}px`,
      maxDelta,
    );
    return;
  }
  compute.markParityOk(maxDelta);
}

export interface WebGpuReadbackState {
  readbackOnceConsumed: boolean;
  lastReadbackOnceVersion: number;
}

export function createWebGpuReadbackState(): WebGpuReadbackState {
  return { readbackOnceConsumed: false, lastReadbackOnceVersion: -1 };
}

export function resolveClodErrorGpuMap(options: {
  enabled: boolean;
  compute: ClodErrorPxCompute | null;
  selectionFrameId: number;
  errorMaxAgeFrames: number;
  readbackMode: WebGpuReadbackMode;
  readbackState: WebGpuReadbackState;
}): ClodErrorMap | null {
  const { enabled, compute, selectionFrameId, errorMaxAgeFrames, readbackMode, readbackState } = options;
  if (!enabled || !compute) return null;
  const candidate = compute.latestFor(selectionFrameId, errorMaxAgeFrames);
  if (!candidate) return null;
  switch (readbackMode) {
    case "off":
      return null;
    case "once":
      if (!readbackState.readbackOnceConsumed) {
        readbackState.readbackOnceConsumed = true;
        readbackState.lastReadbackOnceVersion = candidate.version;
        return candidate;
      }
      return null;
    default:
      return candidate;
  }
}

export function buildClodErrorDispatchOptions(options: {
  readbackMode: WebGpuReadbackMode;
  compute: ClodErrorPxCompute;
  readbackState: WebGpuReadbackState;
}): DispatchOptions {
  const { readbackMode, compute, readbackState } = options;
  switch (readbackMode) {
    case "off":
      return { readback: false };
    case "once": {
      const cv = compute.currentVersion();
      const shouldReadback = !readbackState.readbackOnceConsumed || readbackState.lastReadbackOnceVersion !== cv;
      return { readback: shouldReadback };
    }
    default:
      return { readback: true };
  }
}
