import * as THREE from "three";
import type { CustomPropsSettings, PropGpuStatus } from "./prop_types.js";
import type { LoadedPropAsset } from "./prop_asset_loader.js";
import type { PropSpatialGrid } from "./prop_spatial_grid.js";
import {
  PropGpuRingCompute,
  propGpuRingUnsupportedReason,
  type PropGpuRingSourceData,
  type PropGpuRingStats,
} from "../gpu/prop_ring_compute.js";
import { buildPropGpuRingSource, createPropGpuRingDrawResources } from "./prop_gpu_ring_draw.js";
import {
  propGpuFrustum as _gpuFrustum,
  propGpuFrustumMatrix as _gpuFrustumMatrix,
  type PropGpuRingDrawResources,
  type PropWebGpuBackendAccess,
} from "./prop_system_support.js";

export interface PropGpuRingRuntimeState {
  draw: PropGpuRingDrawResources | null;
  compute: PropGpuRingCompute | null;
  init: Promise<void> | null;
  key: string;
  generation: number;
  stats: PropGpuRingStats | null;
  status: PropGpuStatus;
  loggedError: string | null;
  frustumPlaneScratch: Float32Array;
}

export interface PropGpuRingRuntimeInput {
  state: PropGpuRingRuntimeState;
  root: THREE.Object3D;
  settings: CustomPropsSettings;
  grid: PropSpatialGrid | null;
  loadedAssets: ReadonlyMap<string, LoadedPropAsset>;
  gpuDevice: GPUDevice | null;
  gpuBackend: PropWebGpuBackendAccess | null;
}

export function createPropGpuRingRuntimeState(): PropGpuRingRuntimeState {
  return {
    draw: null,
    compute: null,
    init: null,
    key: "",
    generation: 0,
    stats: null,
    status: "disabled",
    loggedError: null,
    frustumPlaneScratch: new Float32Array(24),
  };
}

export function usesPropGpuRingDraw(settings: CustomPropsSettings): boolean {
  return settings.enabled && settings.gpu.enabled && !settings.gpu.debugForceCpu;
}

export function resolvePropGpuRingStatus(
  settings: CustomPropsSettings,
  state: PropGpuRingRuntimeState,
  gpuDevice: GPUDevice | null | undefined,
  gpuBackend: PropWebGpuBackendAccess | null | undefined,
): PropGpuStatus {
  if (!settings.gpu.enabled) return "disabled";
  if (settings.gpu.debugForceCpu) return "fallback-cpu";
  if (state.status === "ring") return "ring";
  if (!gpuDevice || !gpuBackend) {
    return settings.gpu.fallbackToCpu ? "fallback-cpu" : "unsupported";
  }
  return settings.gpu.fallbackToCpu ? "fallback-cpu" : "unsupported";
}

export function updatePropGpuRing(
  input: PropGpuRingRuntimeInput,
  camera: THREE.PerspectiveCamera,
  streamCenter: [number, number, number],
  ringRadius: number,
): boolean {
  const { state, settings } = input;
  const gpu = settings.gpu;
  if (!input.gpuDevice || !input.gpuBackend || !input.grid) {
    state.status = gpu.fallbackToCpu ? "fallback-cpu" : "unsupported";
    setPropGpuRingVisible(state, false);
    return false;
  }
  const unsupported = propGpuRingUnsupportedReason(input.gpuDevice);
  if (unsupported) {
    state.status = gpu.fallbackToCpu ? "fallback-cpu" : "unsupported";
    if (state.loggedError !== unsupported) {
      state.loggedError = unsupported;
      console.warn(`[props-gpu-ring] falling back to CPU: ${unsupported}`);
    }
    setPropGpuRingVisible(state, false);
    return false;
  }

  ensurePropGpuRing(input);
  if (!state.draw || !state.compute) {
    state.status = gpu.fallbackToCpu ? "fallback-cpu" : "unsupported";
    setPropGpuRingVisible(state, false);
    return false;
  }

  const dispatched = state.compute.dispatch({
    centerX: streamCenter[0],
    centerY: streamCenter[1],
    centerZ: streamCenter[2],
    ringRadius,
    cameraX: camera.position.x,
    cameraY: camera.position.y,
    cameraZ: camera.position.z,
    maxInstancesPerGroup: state.draw.maxInstancesPerGroup,
    frustumPlanes: packPropGpuFrustumPlanes(camera, state.frustumPlaneScratch),
  });
  if (!dispatched) {
    const stats = state.compute.stats(settings.enabled);
    state.stats = stats;
    state.status = stats.status === "failed" && !gpu.fallbackToCpu ? "unsupported" : "fallback-cpu";
    setPropGpuRingVisible(state, false);
    return false;
  }
  state.stats = state.compute.stats(settings.enabled);
  if (state.stats.status === "failed") {
    if (state.stats.reason && state.loggedError !== state.stats.reason) {
      state.loggedError = state.stats.reason;
      console.warn(`[props-gpu-ring] falling back to CPU: ${state.stats.reason}`);
    }
    state.status = gpu.fallbackToCpu ? "fallback-cpu" : "unsupported";
    setPropGpuRingVisible(state, false);
    return false;
  }
  state.status = "ring";
  setPropGpuRingVisible(state, true);
  return true;
}

export function ensurePropGpuRing(input: PropGpuRingRuntimeInput): void {
  const { state, settings } = input;
  if (!input.grid || !input.gpuDevice || !input.gpuBackend) return;
  const source = buildPropGpuRingSourceData(input);
  if (source.groupCount === 0 || source.sourceCount === 0) return;
  const key = [
    input.grid.instances.length,
    source.groupCount,
    settings.gpu.maxVisible,
    settings.gpu.workgroupSize,
    ...settings.props.map((prop) => `${prop.id}:${prop.lod.distances.join(",")}:${prop.culling.maxDistance}`),
  ].join("|");
  if (state.stats?.status === "failed" && state.key === key) return;
  if (state.compute && state.draw && state.key === key) return;
  if (state.init && state.key === key) return;

  clearPropGpuRing(input);
  state.key = key;
  state.draw = createPropGpuRingDrawResources({
    source,
    settings,
    loadedAssets: input.loadedAssets,
    gpuBackend: input.gpuBackend,
  });
  for (const mesh of state.draw.meshes) input.root.add(mesh);
  setPropGpuRingVisible(state, false);
  state.stats = {
    status: "initializing",
    candidateCount: source.sourceCount,
    visibleCount: 0,
    groupCounts: new Array<number>(source.groupCount).fill(0),
    overflowed: false,
    submitMs: null,
    readbackMs: null,
  };
  const initKey = key;
  const initGeneration = state.generation;
  const outputBuffers = {
    instanceA: propGpuBufferForAttribute(input, state.draw.instanceA),
    instanceB: propGpuBufferForAttribute(input, state.draw.instanceB),
    indirectArgs: propGpuBufferForAttribute(input, state.draw.indirect),
  };
  state.init = PropGpuRingCompute.create(input.gpuDevice, source, outputBuffers, settings)
    .then((compute) => {
      if (state.key !== initKey || state.generation !== initGeneration) {
        compute.destroy();
        return;
      }
      state.compute = compute;
      state.stats = compute.stats(settings.enabled);
    })
    .catch((error) => {
      if (state.key !== initKey || state.generation !== initGeneration) return;
      const reason = error instanceof Error ? error.message : String(error);
      state.stats = { ...state.stats!, status: "failed", reason };
    })
    .finally(() => {
      if (state.key === initKey && state.generation === initGeneration) state.init = null;
    });
}

export function clearPropGpuRing(input: PropGpuRingRuntimeInput): void {
  const { state } = input;
  state.generation++;
  state.compute?.destroy();
  state.compute = null;
  state.init = null;
  state.key = "";
  state.stats = null;
  if (state.draw) {
    for (const mesh of state.draw.meshes) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
  state.draw = null;
}

export function setPropGpuRingVisible(state: PropGpuRingRuntimeState, visible: boolean): void {
  if (!state.draw) return;
  for (const mesh of state.draw.meshes) mesh.visible = visible;
}

export function packPropGpuFrustumPlanes(camera: THREE.Camera, scratch: Float32Array): Float32Array {
  (camera as THREE.Camera & { updateProjectionMatrix?: () => void }).updateProjectionMatrix?.();
  camera.updateMatrixWorld(true);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  _gpuFrustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _gpuFrustum.setFromProjectionMatrix(_gpuFrustumMatrix);
  for (let i = 0; i < 6; i++) {
    const plane = _gpuFrustum.planes[i]!;
    const offset = i * 4;
    scratch[offset] = plane.normal.x;
    scratch[offset + 1] = plane.normal.y;
    scratch[offset + 2] = plane.normal.z;
    scratch[offset + 3] = plane.constant;
  }
  return scratch;
}

function buildPropGpuRingSourceData(input: PropGpuRingRuntimeInput): PropGpuRingSourceData {
  return buildPropGpuRingSource({
    grid: input.grid,
    settings: input.settings,
    loadedAssets: input.loadedAssets,
    indexCountFor: (geometry) => geometry.getIndex()?.count ?? geometry.getAttribute("position")?.count ?? 0,
  });
}

function propGpuBufferForAttribute(input: PropGpuRingRuntimeInput, attribute: THREE.BufferAttribute): GPUBuffer {
  if (!input.gpuBackend) throw new Error("Cannot read WebGPU prop buffer without a backend");
  const buffer = input.gpuBackend.get(attribute).buffer;
  if (!buffer) throw new Error(`Missing GPU buffer for ${attribute.name || "prop ring attribute"}`);
  return buffer;
}
