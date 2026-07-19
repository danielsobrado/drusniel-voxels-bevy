import type GUI from "lil-gui";
import {
  resetStreamingRootGpuMesherRuntimeControls,
  setStreamingRootGpuMesherRuntimeControls,
  streamingRootGpuMesherConfigFromWindow,
  type StreamingRootGpuMesherConfig,
  type StreamingRootGpuMesherRuntimeControls,
} from "../../terrain/streaming/streamed_root_gpu_config.js";
import type { GuiController } from "./gui_controller.js";

export interface StreamingRootGpuGuiDeps {
  readConfig(): StreamingRootGpuMesherConfig;
  setControls(controls: Partial<StreamingRootGpuMesherRuntimeControls>): StreamingRootGpuMesherRuntimeControls;
  resetControls(): StreamingRootGpuMesherRuntimeControls;
}

interface StreamingRootGpuGuiModel {
  enabled: boolean;
  fallback: boolean;
  batchSize: number;
  maxInflightBatches: number;
  resetOverrides(): void;
}

const DEFAULT_DEPS: StreamingRootGpuGuiDeps = {
  readConfig: streamingRootGpuMesherConfigFromWindow,
  setControls: setStreamingRootGpuMesherRuntimeControls,
  resetControls: resetStreamingRootGpuMesherRuntimeControls,
};

export function createStreamingRootGpuGui(
  gui: GUI,
  isWebGpu: boolean,
  deps: StreamingRootGpuGuiDeps = DEFAULT_DEPS,
): void {
  const folder = gui.addFolder("CLOD GPU streaming");
  const config = deps.readConfig();
  const model: StreamingRootGpuGuiModel = {
    enabled: config.enabled,
    fallback: config.fallback,
    batchSize: config.batchSize,
    maxInflightBatches: config.maxInflightBatches,
    resetOverrides: () => undefined,
  };
  const liveControllers: GuiController[] = [];

  const refreshLiveControls = () => {
    const current = deps.readConfig();
    model.enabled = current.enabled;
    model.fallback = current.fallback;
    for (const controller of liveControllers) controller.updateDisplay();
  };

  liveControllers.push(
    folder.add(model, "enabled").name("GPU streamed roots").onChange((enabled: boolean) => {
      deps.setControls({ enabled });
    }),
  );
  liveControllers.push(
    folder.add(model, "fallback").name("CPU fallback").onChange((fallback: boolean) => {
      deps.setControls({ fallback });
    }),
  );

  folder.add(model, "batchSize").name("batch pages (startup)").disable();
  folder.add(model, "maxInflightBatches").name("GPU pools (startup)").disable();
  model.resetOverrides = () => {
    deps.resetControls();
    refreshLiveControls();
  };
  folder.add(model, "resetOverrides").name("reset menu overrides");

  if (!isWebGpu) {
    for (const controller of liveControllers) controller.disable();
  }
}
