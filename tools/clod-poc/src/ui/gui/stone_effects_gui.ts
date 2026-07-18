import type GUI from "lil-gui";
import type { ClodAppState } from "../../app/clod_app_state.js";
import type { StoneController } from "../../runtime/vegetation/stone_controller.js";
import {
  riverCobbleGpuAvailable,
  riverCobbleGpuEnabled,
  setRiverCobbleGpuEnabled,
  syncRiverCobbleQuery,
} from "../../stones/river_cobble_runtime.js";

export interface StoneEffectsGuiDeps {
  stoneController: Pick<StoneController, "rebuild">;
  updateInfo: () => void;
}

export function createStoneEffectsGui(
  gui: GUI,
  state: ClodAppState,
  deps: StoneEffectsGuiDeps,
): void {
  state.stoneRiverCobblesEnabled = riverCobbleGpuEnabled();
  setRiverCobbleGpuEnabled(state.stoneRiverCobblesEnabled);

  const folder = gui.addFolder("stone effects");
  const controller = folder
    .add(state, "stoneRiverCobblesEnabled")
    .name("underwater river cobbles")
    .onChange((enabled: boolean) => {
      setRiverCobbleGpuEnabled(enabled);
      syncRiverCobbleQuery(enabled);
      deps.stoneController.rebuild();
      deps.updateInfo();
    });

  if (!riverCobbleGpuAvailable()) controller.disable();
}
