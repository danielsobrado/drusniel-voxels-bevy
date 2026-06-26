import type GUI from "lil-gui";
import type { ShadowProxyController } from "../../shadows/shadowProxyController.js";
import type { ShadowProxyDebugState } from "../../shadows/shadowProxyDebug.js";
import { formatShadowProxyStatsLine } from "../../shadows/shadowProxyStats.js";
import { shadowProxyDebugStateToConfig } from "../../shadows/shadowProxyDebug.js";
import type { GuiController } from "./gui_controller.js";

export interface ShadowProxyGuiDeps {
  shadowProxyController: ShadowProxyController | null;
  farShellController: import("../../systems/far_shell_controller.js").FarShellController;
  infiniteFarShell?: import("../../long-view/infiniteFarShell.js").InfiniteFarShell;
  getDebugState: () => ShadowProxyDebugState;
  setDebugState: (state: ShadowProxyDebugState) => void;
  getBaseConfig: () => import("../../shadows/shadowProxyTypes.js").ShadowProxyConfig;
  updateInfo: () => void;
}

export function createShadowProxyGui(
  gui: GUI,
  deps: ShadowProxyGuiDeps,
): { statsController: GuiController | null } {
  if (!deps.shadowProxyController) return { statsController: null };

  const folder = gui.addFolder("shadow proxy");
  const state = deps.getDebugState();

  folder.add(state, "shadowProxyEnabled").name("enabled").onChange(() => {
    deps.shadowProxyController?.setProxyEnabled(state.shadowProxyEnabled);
    deps.setDebugState(state);
    deps.updateInfo();
  });
  folder.add(state, "sunShadowsEnabled").name("sun shadows").onChange(() => {
    deps.shadowProxyController?.setSunShadowsEnabled(state.sunShadowsEnabled);
    deps.farShellController.rebuild();
    deps.infiniteFarShell?.setReceiveSunShadows(state.sunShadowsEnabled);
    deps.setDebugState(state);
    deps.updateInfo();
  });
  folder.add(state, "debugVisibleProxy").name("debug visible").onChange(applyDebug);
  folder.add(state, "debugWireframe").name("debug wireframe").onChange(applyDebug);
  folder.add(state, "debugFreezeProxy").name("debug freeze").onChange(applyDebug);
  folder.add(state, "debugShowBounds").name("debug bounds").onChange(applyDebug);
  folder.add(state, "showSunShadowCamera").name("shadow cam helper").onChange(() => {
    deps.shadowProxyController?.setShadowCameraHelperVisible(state.showSunShadowCamera);
    deps.updateInfo();
  });
  folder.add(state, "heightBiasM", 0, 4, 0.05).name("height bias m").onFinishChange(applyDebug);
  folder.add(state, "lightShadowBias", -0.01, 0.01, 0.00001).name("shadow bias").onFinishChange(applyDebug);
  folder.add(state, "lightShadowNormalBias", 0, 4, 0.05).name("normal bias").onFinishChange(applyDebug);
  folder.add(state, "lightShadowMapSize", { "1024": 1024, "2048": 2048, "4096": 4096 }).name("map size").onChange(applyDebug);

  const statsController = folder.add(state, "shadowProxyStatsLine").name("stats").disable();

  function applyDebug() {
    const merged = shadowProxyDebugStateToConfig(state, deps.getBaseConfig());
    deps.setDebugState({ ...state, ...merged, shadowProxyEnabled: state.shadowProxyEnabled });
    deps.shadowProxyController?.applyDebugConfig();
    state.shadowProxyStatsLine = formatShadowProxyStatsLine(deps.shadowProxyController!.runtime.stats);
    statsController?.updateDisplay();
    deps.updateInfo();
  }

  state.shadowProxyStatsLine = formatShadowProxyStatsLine(deps.shadowProxyController.runtime.stats);
  statsController?.updateDisplay();

  return { statsController };
}
