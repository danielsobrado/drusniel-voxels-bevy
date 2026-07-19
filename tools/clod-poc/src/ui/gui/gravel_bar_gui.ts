import type GUI from "lil-gui";
import {
  gravelBarStonesEnabled,
  resetGravelBarRuntimeOverrides,
  setGravelBarStonesEnabled,
} from "../../water/gravel_bar_runtime.js";
import type { GuiController } from "./gui_controller.js";

export interface GravelBarGuiDeps {
  readonly rebuildStones: () => void;
}

interface GravelBarGuiModel {
  stonesEnabled: boolean;
  resetStonesOverride: () => void;
}

export function addGravelBarGui(folder: GUI, deps: GravelBarGuiDeps): void {
  const model: GravelBarGuiModel = {
    stonesEnabled: gravelBarStonesEnabled(),
    resetStonesOverride: () => undefined,
  };
  const liveControllers: GuiController[] = [];

  liveControllers.push(folder.add(model, "stonesEnabled")
    .name("gravel bar stones")
    .onChange((enabled: boolean) => {
      setGravelBarStonesEnabled(enabled);
      deps.rebuildStones();
    }));

  model.resetStonesOverride = () => {
    resetGravelBarRuntimeOverrides();
    model.stonesEnabled = gravelBarStonesEnabled();
    for (const controller of liveControllers) controller.updateDisplay();
    deps.rebuildStones();
  };
  folder.add(model, "resetStonesOverride").name("reset gravel override");
}
