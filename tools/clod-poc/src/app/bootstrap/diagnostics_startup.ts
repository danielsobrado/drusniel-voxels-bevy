import { initHooks, type ClodHooks, type EngineStats } from "../../core/hooks.js";
import type { TerrainSummaryField } from "../../clod/terrain_summary.js";
import { ClodErrorPxCompute } from "../../gpu/clod_error_px_compute.js";
import { requestWebGpuDevice } from "../../gpu/webgpu_device.js";
import type { ClodPageNode } from "../../types.js";
import type { AppRenderer } from "./renderer_startup.js";

export function publishTerrainSummaryForDiagnostics(summary: TerrainSummaryField): void {
  window.__drusnielTerrainSummary = summary;
}

export interface LongViewDiagnosticsContext {
  longViewHooks: ClodHooks | null;
  longViewSettleWaiters: { frames: number; resolve: () => void }[];
  getClodErrorCompute: () => ClodErrorPxCompute | null;
  getWebGpuUnavailableReason: () => string | null;
  ensureClodErrorCompute: () => Promise<void>;
}

export function initLongViewDiagnostics(input: {
  isLongView: boolean;
  maxTerrainLevel: number;
  worldCells: number;
  phase0TargetVisibleM: number;
  camera: import("three").PerspectiveCamera;
  controls: import("three/examples/jsm/controls/OrbitControls.js").OrbitControls;
}): Pick<LongViewDiagnosticsContext, "longViewHooks" | "longViewSettleWaiters"> {
  const longViewSettleWaiters: { frames: number; resolve: () => void }[] = [];
  if (!input.isLongView) {
    return { longViewHooks: null, longViewSettleWaiters };
  }

  const longViewHooks = initHooks();
  longViewHooks.progress = 0.5;
  longViewHooks.progressMsg = "building world";
  longViewHooks.settle = (frames = 8) => new Promise((resolve) => longViewSettleWaiters.push({ frames, resolve }));
  longViewHooks.flyCamEnabled = (_on) => { /* orbit-only in main app */ };
  longViewHooks.setPose = (pose) => {
    input.controls.target.set(pose.p[0], pose.p[1], pose.p[2]);
    input.camera.rotation.set(pose.pitch, pose.yaw, 0, "YXZ");
    if (pose.fov) { input.camera.fov = pose.fov; input.camera.updateProjectionMatrix(); }
  };
  longViewHooks.getPose = () => ({
    p: [input.controls.target.x, input.controls.target.y, input.controls.target.z],
    yaw: input.camera.rotation.y,
    pitch: input.camera.rotation.x,
    fov: input.camera.fov,
  });

  return { longViewHooks, longViewSettleWaiters };
}

export function seedLongViewStats(
  longViewHooks: ClodHooks | null,
  input: {
    maxTerrainLevel: number;
    worldCells: number;
    phase0TargetVisibleM: number;
  },
): void {
  if (!longViewHooks) return;
  const lvStats: EngineStats = {
    fps: 0, frameMs: 0, frameMsP95: 0, drawCalls: 0, triangles: 0,
    frame: 0, counters: {}, gpuPasses: {},
  };
  longViewHooks.stats = lvStats;
  const maxLvl = input.maxTerrainLevel;
  for (let lvl = 0; lvl <= maxLvl; lvl++) {
    lvStats.counters[`built_page_count_lod${lvl}`] = 0;
  }
  lvStats.counters["far_shell_tris"] = 0;
  lvStats.counters["far_shell_gpu_ms"] = 0;
  lvStats.counters["shadow_proxy_tris"] = 0;
  lvStats.counters["canopy_tris"] = 0;
  lvStats.counters["horizon_hole_ratio"] = -1;
  lvStats.counters["gpu_grass_visible"] = 0;
  lvStats.counters["gpu_grass_dispatch_ms"] = 0;
  lvStats.counters["gpu_tree_visible"] = 0;
  lvStats.counters["gpu_tree_dispatch_ms"] = 0;
  lvStats.counters["gpu_stone_visible"] = 0;
  lvStats.counters["gpu_stone_drawn_near"] = 0;
  lvStats.counters["gpu_stone_drawn_far"] = 0;
  lvStats.counters["world_cells"] = input.worldCells;
  lvStats.counters["target_visible_m"] = input.phase0TargetVisibleM;
  lvStats.counters["effective_far_radius_m"] = 0;
  lvStats.counters["effective_visible_m"] = 0;
  lvStats.counters["visible_target_met"] = 0;
  lvStats.counters["far_shell_enabled"] = 0;
  lvStats.counters["far_shell_radius_m"] = 0;
  lvStats.counters["far_shell_grid_res"] = 0;
  lvStats.counters["shadow_proxy_enabled"] = 0;
  lvStats.counters["shadow_proxy_inert"] = 1;
  lvStats.counters["canopy_enabled"] = 0;
  for (let lvl = 0; lvl <= maxLvl; lvl++) {
    lvStats.counters[`rendered_page_count_lod${lvl}`] = 0;
  }
  lvStats.counters["rendered_terrain_tris"] = 0;
  lvStats.counters["total_scene_tris"] = 0;
  lvStats.counters["frame_ms_avg"] = 0;
  lvStats.counters["frame_ms_p95"] = -1;
  lvStats.counters["frame_ms_p99"] = -1;
  lvStats.counters["streamer_simulated_required_chunks"] = 0;
  lvStats.counters["streamer_simulated_required_pages"] = 0;
  lvStats.counters["streamer_simulated_missing_chunks"] = 0;
  lvStats.counters["streamer_simulated_missing_pages"] = 0;
  lvStats.counters["stale_fallback_count"] = 0;
}

export function createClodErrorComputeAccess(input: {
  app: AppRenderer;
  rendererWebGpuDevice: GPUDevice | null;
  allNodes: ClodPageNode[];
}): Pick<LongViewDiagnosticsContext, "getClodErrorCompute" | "getWebGpuUnavailableReason" | "ensureClodErrorCompute"> {
  let clodErrorCompute: ClodErrorPxCompute | null = null;
  let webGpuUnavailableReason: string | null = null;
  let webGpuInitPromise: Promise<void> | null = null;
  let standaloneComputeDevice: GPUDevice | null = null;

  const ensureClodErrorCompute = (): Promise<void> => {
    if (clodErrorCompute || webGpuUnavailableReason) return Promise.resolve();
    if (!webGpuInitPromise) {
      webGpuInitPromise = (async () => {
        let device: GPUDevice | undefined;
        if (input.app.isWebGpu) {
          if (!input.rendererWebGpuDevice) {
            webGpuUnavailableReason = "WebGPU renderer did not expose a GPUDevice";
            return;
          }
          device = input.rendererWebGpuDevice;
        } else {
          if (!standaloneComputeDevice) {
            const deviceResult = await requestWebGpuDevice();
            if (!deviceResult.ok) {
              webGpuUnavailableReason = deviceResult.message;
              return;
            }
            standaloneComputeDevice = deviceResult.device;
          }
          device = standaloneComputeDevice;
        }
        const { compute, unavailable } = await ClodErrorPxCompute.create(input.allNodes, device);
        clodErrorCompute = compute;
        webGpuUnavailableReason = unavailable?.message ?? null;
      })()
        .catch((error) => {
          webGpuUnavailableReason = error instanceof Error ? error.message : String(error);
        })
        .finally(() => {
          webGpuInitPromise = null;
        });
    }
    return webGpuInitPromise;
  };

  return {
    getClodErrorCompute: () => clodErrorCompute,
    getWebGpuUnavailableReason: () => webGpuUnavailableReason,
    ensureClodErrorCompute,
  };
}
