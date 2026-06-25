import type GUI from "lil-gui";
import { addWaterDebugFolder, WATER_DEBUG_MODES, type WaterDebugState } from "../../water/index.js";
import type { WaterController } from "../../runtime/water_weather/water_controller.js";

export interface WaterGuiDeps {
  waterController: WaterController;
  waterDebugState: WaterDebugState;
  makeWaterVisual: () => ReturnType<WaterController["makeVisual"]>;
  setWaterEnabled: (enabled: boolean) => void;
  setWaterDebugMode: (mode: keyof typeof WATER_DEBUG_MODES) => void;
  setWaterClipmapTint: (enabled: boolean) => void;
  setWaterWireframe: (enabled: boolean) => void;
  setWaterDepthWrite: (on: boolean) => void;
}

export function createWaterGui(gui: GUI, deps: WaterGuiDeps): void {
  addWaterDebugFolder(gui, deps.waterDebugState, {
    onEnabled: (enabled) => {
      deps.setWaterEnabled(enabled);
      deps.waterController.setVisible(enabled);
    },
    onMode: (mode) => {
      deps.setWaterDebugMode(mode);
      deps.waterController.setDebugMode(mode);
    },
    onClipmapTint: (enabled) => {
      deps.setWaterClipmapTint(enabled);
      deps.waterController.setClipmapTint(enabled);
    },
    onWireframe: (enabled) => {
      deps.setWaterWireframe(enabled);
      deps.waterController.setWireframe(enabled);
    },
    onDepthWrite: (on) => {
      deps.setWaterDepthWrite(on);
    },
    onOceanEnabled: (enabled) => deps.waterController.setOceanEnabled(enabled),
    onOceanStartDistance: (distance) => deps.waterController.setOceanStartDistance(distance),
    onOceanFullDepthDistance: (distance) => deps.waterController.setOceanFullDepthDistance(distance),
    onOceanMaxDepth: (depth) => deps.waterController.setOceanMaxDepth(depth),
    onRebuildVisual: () => {
      deps.waterController.updateVisual(deps.makeWaterVisual());
    },
  });
}
