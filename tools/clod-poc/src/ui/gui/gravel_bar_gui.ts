import type GUI from "lil-gui";
import {
  gravelBarStonesEnabled,
  readGravelBedSettings,
  resetGravelBarRuntimeOverrides,
  setGravelBarStonesEnabled,
} from "../../water/gravel_bar_runtime.js";
import type { GuiController } from "./gui_controller.js";

export interface GravelBarGuiDeps {
  readonly rebuildStones: () => void;
}

interface EnvironmentGuiController extends GuiController {
  name(label: string): EnvironmentGuiController;
  disable(): EnvironmentGuiController;
}

interface GravelBarGuiModel {
  stonesEnabled: boolean;
  bedAuthority: string;
  resetStonesOverride: () => void;
}

export function addGravelBarGui(folder: GUI, deps: GravelBarGuiDeps): void {
  const bed = readGravelBedSettings();
  const model: GravelBarGuiModel = {
    stonesEnabled: gravelBarStonesEnabled(),
    bedAuthority: bed.enabled ? "enabled at startup" : "disabled in water.yaml",
    resetStonesOverride: () => undefined,
  };
  const liveControllers: GuiController[] = [];

  liveControllers.push(folder.add(model, "stonesEnabled")
    .name("gravel bar stones")
    .onChange((enabled: boolean) => {
      setGravelBarStonesEnabled(enabled);
      deps.rebuildStones();
    }));
  (folder.add(model, "bedAuthority") as EnvironmentGuiController)
    .name("gravel bed authority")
    .disable();

  model.resetStonesOverride = () => {
    resetGravelBarRuntimeOverrides();
    model.stonesEnabled = gravelBarStonesEnabled();
    for (const controller of liveControllers) controller.updateDisplay();
    deps.rebuildStones();
  };
  folder.add(model, "resetStonesOverride").name("reset gravel override");
}
