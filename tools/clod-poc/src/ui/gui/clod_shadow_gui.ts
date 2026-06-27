import type GUI from "lil-gui";
import type { ClodAppState } from "../../app/clod_app_state.js";
import type { GuiController } from "./gui_controller.js";

export interface ClodShadowGuiDeps {
  updateOverlay: () => void;
  updateInfo: () => void;
}

export function createClodShadowGui(
  gui: GUI,
  state: ClodAppState,
  deps: ClodShadowGuiDeps,
): { statsController: GuiController | null } {
  const folder = gui.addFolder("CLOD shadows");
  folder.open();
  const controllers: GuiController[] = [];

  controllers.push(
    folder.add(state, "clodShadowOverlayMode", ["off", "casters", "all"]).name("overlay mode").onChange(() => {
      deps.updateOverlay();
      deps.updateInfo();
    }),
  );
  controllers.push(
    folder.add(state, "clodShadowProxyView", ["off", "proxy-meshes"]).name("proxy view").onChange(() => {
      deps.updateOverlay();
      deps.updateInfo();
    }),
  );
  controllers.push(
    folder.add(state, "clodShadowProxyWireframe").name("proxy wireframe").onChange(() => {
      deps.updateOverlay();
      deps.updateInfo();
    }),
  );

  const statsController = folder.add(state, "clodShadowStatsLine").name("stats").disable();

  const actions = {
    reset: () => {
      state.clodShadowOverlayMode = "off";
      state.clodShadowProxyView = "off";
      state.clodShadowProxyWireframe = true;
      state.clodShadowStatsLine = "";
      deps.updateOverlay();
      deps.updateInfo();
      for (const c of controllers) c.updateDisplay();
      statsController?.updateDisplay();
    },
  };
  folder.add(actions, "reset").name("reset");

  return { statsController };
}
